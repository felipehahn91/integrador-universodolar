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
    const contactsEndpoint = `${magazordBaseUrl}/v2/site/pessoa`;
    
    logs.push(`${timestamp()} Conectando à API Magazord em ${contactsEndpoint}...`);
    const contactsResponse = await fetch(contactsEndpoint, {
      headers: { 'Authorization': authHeader },
    });

    if (!contactsResponse.ok) {
      throw new Error(`Erro na API Magazord (Contatos): Status ${contactsResponse.status} - ${contactsResponse.statusText}`);
    }
    logs.push(`${timestamp()} Conexão com a API Magazord bem-sucedida.`);
    const contactsResult = await contactsResponse.json();
    
    logs.push(`${timestamp()} Resposta recebida da API Magazord: ${JSON.stringify(contactsResult, null, 2)}`);

    const allContacts = contactsResult.data.items;

    if (!Array.isArray(allContacts)) {
      throw new Error('A resposta da API Magazord não retornou uma lista de contatos válida.');
    }
    logs.push(`${timestamp()} Encontrados ${allContacts.length} contatos no total.`);

    const excludedDomains = new Set(settings.excluded_domains || []);
    const filteredContacts = allContacts.filter(contact => {
      if (!contact.email || !contact.id) return false;
      const domain = contact.email.split('@')[1];
      return domain && !excludedDomains.has(domain.toLowerCase());
    });

    const contactsToProcess = filteredContacts.slice(0, settings.batch_size);
    logs.push(`${timestamp()} Contatos filtrados. Processando um lote de ${contactsToProcess.length} contatos.`);

    let successCount = 0;
    let errorCount = 0;
    const processedContactsForPreview = [];

    for (const contact of contactsToProcess) {
      try {
        logs.push(`${timestamp()} Processando ${contact.email} (ID: ${contact.id})...`);
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
          logs.push(`${timestamp()} -> Encontrados ${deliveredOrders.length} pedidos entregues.`);
        } else {
          logs.push(`${timestamp()} -> Aviso: Não foi possível buscar pedidos para ${contact.email} (Status: ${ordersResponse.status}).`);
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

        const contactForDb = {
          magazord_id: String(contact.id),
          nome: contact.nome,
          email: contact.email,
          cpf_cnpj: contact.cpfCnpj,
          tipo_pessoa: tipoPessoa,
          sexo: contact.sexo,
          total_compras: total_compras,
          valor_total_gasto: valor_total_gasto,
          tags: tags,
          last_processed_at: new Date().toISOString(),
        };

        const { error: upsertError } = await supabaseAdmin
          .from('magazord_contacts')
          .upsert(contactForDb, { onConflict: 'magazord_id' });

        if (upsertError) throw upsertError;

        await pushToMautic(contact);
        successCount++;
        logs.push(`${timestamp()} -> Sucesso: Contato salvo no DB e enviado para Mautic (simulação).`);
        
        if (processedContactsForPreview.length < 5) {
            processedContactsForPreview.push({ ...contact, total_compras, valor_total_gasto, tags });
        }

      } catch (error) {
        errorCount++;
        logs.push(`${timestamp()} -> ERRO ao processar ${contact.email}: ${error.message}`);
        console.error(`Falha ao processar o contato ${contact.email}:`, error.message);
      }
    }

    const message = `Simulação concluída. Processados: ${contactsToProcess.length}. Salvos no DB: ${successCount}. Falhas: ${errorCount}.`;
    logs.push(`${timestamp()} ${message}`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        data: { message, processedContacts: processedContactsForPreview }, 
        logs 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    const errorMessage = `Erro fatal na função: ${error.message}`;
    logs.push(`${timestamp()} ${errorMessage}`);
    console.error('Erro fatal na função de sincronização:', error.message);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: { message: error.message }, 
        logs 
      }), 
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  }
})