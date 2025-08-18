import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- Mautic API Helper (Temporariamente desativado para simulação) ---
async function pushToMautic(contactData: any) {
  // This is just a simulation
  return { contact: { id: Math.floor(Math.random() * 1000) } };
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const logs: string[] = [];
  const timestamp = () => `[${new Date().toLocaleTimeString()}]`;

  try {
    const { limit = null } = await req.json().catch(() => ({ limit: null }));
    logs.push(`${timestamp()} Iniciando função de sincronização...`);
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    logs.push(`${timestamp()} Buscando segredos e configurações...`);
    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');

    if (!magazordApiToken || !magazordApiSecret) {
      throw new Error('As credenciais da API Magazord não foram configuradas nos segredos.');
    }

    const authString = `${magazordApiToken}:${magazordApiSecret}`;
    const authHeader = `Basic ${btoa(authString)}`;
    logs.push(`${timestamp()} Header de autenticação Basic Auth criado.`);

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from('settings')
      .select('*')
      .eq('singleton_key', 1)
      .single();

    if (settingsError) throw settingsError;
    logs.push(`${timestamp()} Configurações carregadas: Intervalo de ${settings.sync_interval_minutes} min, Lote de ${settings.batch_size}.`);

    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';
    const excludedDomains = new Set(settings.excluded_domains || []);
    const desiredCount = limit === null ? Infinity : limit;

    let collectedFilteredContacts = [];
    let currentPage = 1;
    let hasMorePages = true;
    logs.push(`${timestamp()} Iniciando coleta de contatos da API Magazord com paginação...`);

    while (hasMorePages && collectedFilteredContacts.length < desiredCount) {
      const endpoint = `${magazordBaseUrl}/v2/site/pessoa?pagina=${currentPage}`;
      const response = await fetch(endpoint, { headers: { 'Authorization': authHeader } });

      if (!response.ok) {
        logs.push(`${timestamp()} Aviso: Falha ao buscar página ${currentPage} (Status: ${response.status}). Parando a coleta.`);
        hasMorePages = false;
        continue;
      }

      const result = await response.json();
      const rawContactsFromPage = result.data?.items || [];

      if (rawContactsFromPage.length === 0) {
        hasMorePages = false;
        logs.push(`${timestamp()} Nenhuma página adicional de contatos encontrada. Fim da coleta.`);
        continue;
      }

      const filteredContactsFromPage = rawContactsFromPage.filter(contact => {
        if (!contact.email || !contact.id) return false;
        const domain = contact.email.split('@')[1];
        return domain && !excludedDomains.has(domain.toLowerCase());
      });

      collectedFilteredContacts.push(...filteredContactsFromPage);
      logs.push(`${timestamp()} Página ${currentPage} carregada. Contatos válidos coletados: ${collectedFilteredContacts.length}.`);
      currentPage++;
    }

    const contactsToProcess = collectedFilteredContacts.slice(0, desiredCount);
    logs.push(`${timestamp()} Coleta finalizada. Processando um lote de ${contactsToProcess.length} contatos.`);

    let successCount = 0;
    let errorCount = 0;
    const processedContactsForPreview = [];

    for (const contact of contactsToProcess) {
      try {
        logs.push(`${timestamp()} Processando ${contact.email} (ID: ${contact.id})...`);
        const magazordContactId = String(contact.id);

        const { data: existingContact, error: selectError } = await supabaseAdmin
          .from('magazord_contacts')
          .select('id')
          .eq('magazord_id', magazordContactId)
          .single();

        if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = 0 rows
          throw new Error(`Erro ao checar contato: ${selectError.message}`);
        }
        
        const tags = [];
        let tipoPessoa = null;
        if (contact.tipo === 1) {
          tags.push('Pessoa Física');
          tipoPessoa = 'F';
        } else if (contact.tipo === 2) {
          tags.push('Pessoa Jurídica');
          tipoPessoa = 'J';
        }
        if (contact.sexo === 'M') tags.push('Masculino');
        else if (contact.sexo === 'F') tags.push('Feminino');

        const contactData = {
          nome: contact.nome,
          email: contact.email,
          cpf_cnpj: contact.cpfCnpj,
          tipo_pessoa: tipoPessoa,
          sexo: contact.sexo,
          tags: tags,
          last_processed_at: new Date().toISOString(),
        };

        let dbContactId;

        if (existingContact) {
          logs.push(`${timestamp()} -> Contato ${contact.email} já existe. Atualizando...`);
          const { error: updateError } = await supabaseAdmin
            .from('magazord_contacts')
            .update(contactData)
            .eq('magazord_id', magazordContactId);
          
          if (updateError) throw updateError;
          dbContactId = existingContact.id;
          logs.push(`${timestamp()} -> Contato atualizado no DB.`);
        } else {
          logs.push(`${timestamp()} -> Contato ${contact.email} é novo. Inserindo...`);
          const { data: newDbContact, error: insertError } = await supabaseAdmin
            .from('magazord_contacts')
            .insert({ ...contactData, magazord_id: magazordContactId })
            .select('id')
            .single();
          
          if (insertError) throw insertError;
          dbContactId = newDbContact.id;
          logs.push(`${timestamp()} -> Contato inserido no DB com ID: ${dbContactId}.`);
        }

        const ordersEndpoint = `${magazordBaseUrl}/v2/site/pedido?CpfCnpj=${contact.cpfCnpj}`;
        const ordersResponse = await fetch(ordersEndpoint, {
          headers: { 'Authorization': authHeader },
        });

        let total_compras = 0;
        let valor_total_gasto = 0;

        if (ordersResponse.ok) {
          const ordersResult = await ordersResponse.json();
          const orders = ordersResult.data?.items || [];
          const deliveredOrders = orders.filter(o => o.Status === 'Entregue');
          
          total_compras = deliveredOrders.length;
          valor_total_gasto = deliveredOrders.reduce((sum, order) => sum + (parseFloat(order.ValorTotal) || 0), 0);
          
          if (deliveredOrders.length > 0) {
            const ordersForDb = deliveredOrders.map(order => ({
              contact_id: dbContactId,
              magazord_order_id: String(order.Id),
              valor_total: parseFloat(order.ValorTotal) || 0,
              status: order.Status,
              data_pedido: order.DataPedido,
            }));

            const { error: orderUpsertError } = await supabaseAdmin
              .from('magazord_orders')
              .upsert(ordersForDb, { onConflict: 'magazord_order_id' });
            
            if (orderUpsertError) throw orderUpsertError;
          }
        } else {
          logs.push(`${timestamp()} -> Aviso: Não foi possível buscar pedidos para ${contact.email} (Status: ${ordersResponse.status}).`);
        }

        const { error: updateTotalError } = await supabaseAdmin
          .from('magazord_contacts')
          .update({
            total_compras: total_compras,
            valor_total_gasto: valor_total_gasto,
          })
          .eq('id', dbContactId);

        if (updateTotalError) throw updateTotalError;

        await pushToMautic(contact);
        successCount++;
        
        if (processedContactsForPreview.length < 5) {
            processedContactsForPreview.push({ ...contact, total_compras, valor_total_gasto, tags });
        }

      } catch (error) {
        errorCount++;
        const errorDetails = error && typeof error === 'object' && 'message' in error ? String(error.message) : JSON.stringify(error);
        logs.push(`${timestamp()} -> ERRO ao processar ${contact.email}: ${errorDetails}`);
        try {
          logs.push(`${timestamp()} -> DADOS DO CONTATO COM FALHA: ${JSON.stringify(contact, null, 2)}`);
        } catch {
          logs.push(`${timestamp()} -> DADOS DO CONTATO COM FALHA: (Não foi possível serializar os dados)`);
        }
        console.error(`Falha ao processar o contato ${contact.email}:`, error);
      }
    }

    const message = `Sincronização concluída. Processados: ${contactsToProcess.length}. Sucesso: ${successCount}. Falhas: ${errorCount}.`;
    logs.push(`${timestamp()} ${message}`);
    
    const overallSuccess = errorCount === 0;

    return new Response(
      JSON.stringify({ 
        success: overallSuccess, 
        data: { message, processedContacts: processedContactsForPreview }, 
        logs 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: overallSuccess ? 200 : 422 // 422 Unprocessable Entity
      }
    )
  } catch (error) {
    const errorMessage = `Erro fatal na função: ${error.message}`;
    logs.push(`${timestamp()} ${errorMessage}`);
    console.error('Erro fatal na função de sincronização:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: { message: errorMessage }, 
        logs 
      }), 
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
})