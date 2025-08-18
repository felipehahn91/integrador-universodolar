import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- Mautic API Helper (Temporariamente desativado para simulação) ---
async function pushToMautic(contactData: any) {
  console.log(`[SIMULAÇÃO] Enviando para o Mautic: ${contactData.Email}`);
  return { contact: { id: Math.floor(Math.random() * 1000) } };
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // --- Pega Segredos e Configurações ---
    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');

    if (!magazordApiToken || !magazordApiSecret) {
      throw new Error('As credenciais da API Magazord não foram configuradas nos segredos.');
    }

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from('settings')
      .select('*')
      .eq('singleton_key', 1)
      .single();

    if (settingsError) throw settingsError;

    // --- 1. Busca Contatos da Magazord ---
    const magazordBaseUrl = 'https://api.magazord.com.br/v1';
    const contactsEndpoint = `${magazordBaseUrl}/pessoa`;
    
    console.log('Buscando contatos da Magazord...');
    const contactsResponse = await fetch(contactsEndpoint, {
      headers: { 'token': magazordApiToken, 'secret': magazordApiSecret },
    });

    if (!contactsResponse.ok) throw new Error(`Erro na API Magazord (Contatos): ${contactsResponse.status}`);
    const contactsResult = await contactsResponse.json();
    const allContacts = contactsResult.registros;

    if (!Array.isArray(allContacts)) throw new Error('A resposta da API Magazord não retornou uma lista de contatos.');
    console.log(`Encontrados ${allContacts.length} contatos no total.`);

    // --- 2. Filtra e Processa Contatos em Lotes ---
    const excludedDomains = new Set(settings.excluded_domains || []);
    const filteredContacts = allContacts.filter(contact => {
      if (!contact.Email || !contact.Codigo) return false;
      const domain = contact.Email.split('@')[1];
      return domain && !excludedDomains.has(domain.toLowerCase());
    });

    const contactsToProcess = filteredContacts.slice(0, settings.batch_size);
    console.log(`Filtrando e processando um lote de ${contactsToProcess.length} contatos.`);

    let successCount = 0;
    let errorCount = 0;
    const processedContactsForPreview = [];

    for (const contact of contactsToProcess) {
      try {
        // --- 3. Enriquece Contato com Dados de Pedidos ---
        const ordersEndpoint = `${magazordBaseUrl}/pedido?CpfCnpj=${contact.CpfCnpj}`;
        const ordersResponse = await fetch(ordersEndpoint, {
          headers: { 'token': magazordApiToken, 'secret': magazordApiSecret },
        });

        let total_compras = 0;
        let valor_total_gasto = 0;

        if (ordersResponse.ok) {
          const ordersResult = await ordersResponse.json();
          const orders = ordersResult.registros || [];
          const deliveredOrders = orders.filter(o => o.Status === 'Entregue');
          total_compras = deliveredOrders.length;
          valor_total_gasto = deliveredOrders.reduce((sum, order) => sum + (parseFloat(order.ValorTotal) || 0), 0);
        }

        // --- 4. Adiciona Tags ---
        const tags = [];
        if (contact.PessoaFisicaJuridica === 'F') tags.push('Pessoa Física');
        else if (contact.PessoaFisicaJuridica === 'J') tags.push('Pessoa Jurídica');
        if (contact.Sexo === 'M') tags.push('Masculino');
        else if (contact.Sexo === 'F') tags.push('Feminino');

        // --- 5. Prepara dados para o banco ---
        const contactForDb = {
          magazord_id: contact.Codigo,
          nome: contact.Nome,
          email: contact.Email,
          cpf_cnpj: contact.CpfCnpj,
          tipo_pessoa: contact.PessoaFisicaJuridica,
          sexo: contact.Sexo,
          total_compras: total_compras,
          valor_total_gasto: valor_total_gasto,
          tags: tags,
          last_processed_at: new Date().toISOString(),
        };

        // --- 6. Salva no Supabase ---
        const { error: upsertError } = await supabaseAdmin
          .from('magazord_contacts')
          .upsert(contactForDb, { onConflict: 'magazord_id' });

        if (upsertError) throw upsertError;

        // --- 7. Envia para o Mautic (SIMULAÇÃO) ---
        await pushToMautic(contact);
        successCount++;
        
        if (processedContactsForPreview.length < 5) {
            processedContactsForPreview.push({ ...contact, total_compras, valor_total_gasto, tags });
        }

      } catch (error) {
        errorCount++;
        console.error(`Falha ao processar o contato ${contact.Email}:`, error.message);
      }
    }

    const message = `Simulação concluída. Processados: ${contactsToProcess.length}. Salvos no DB: ${successCount}. Falhas: ${errorCount}.`;
    console.log(message);

    return new Response(
      JSON.stringify({ message, processedContacts: processedContactsForPreview }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Erro fatal na função de sincronização:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})