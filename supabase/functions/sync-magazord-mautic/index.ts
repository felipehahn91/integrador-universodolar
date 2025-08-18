import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- Mautic API Helper ---
// Esta função cria ou atualiza um contato no Mautic
async function pushToMautic(contactData: any) {
  const mauticUrl = Deno.env.get('MAUTIC_BASE_URL') || 'https://marketing.mautic5-web.mldmuf.easypanel.host/';
  const mauticUser = Deno.env.get('MAUTIC_USERNAME');
  const mauticPassword = Deno.env.get('MAUTIC_PASSWORD');

  if (!mauticUrl || !mauticUser || !mauticPassword) {
    throw new Error('As credenciais da API Mautic não foram configuradas nos segredos.');
  }

  const endpoint = `${mauticUrl}api/contacts/new`;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + btoa(`${mauticUser}:${mauticPassword}`),
  };

  const [firstName, ...lastNameParts] = contactData.Nome.split(' ');
  const lastName = lastNameParts.join(' ');

  const payload = {
    firstname: firstName,
    lastname: lastName || firstName, // Mautic exige um sobrenome
    email: contactData.Email,
    mobile: contactData.TelefoneCelular,
    tags: contactData.tags || [],
    // IMPORTANTE: Estes são os campos personalizados que você precisa criar no Mautic.
    total_compras: contactData.total_compras,
    valor_total_gasto: contactData.valor_total_gasto,
    overwriteWithBlank: false,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Erro ao enviar contato ${contactData.Email} para o Mautic:`, errorBody);
    throw new Error(`Erro Mautic: ${response.status}`);
  }

  return await response.json();
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // --- Pega Segredos e Configurações ---
    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');

    if (!magazordApiToken || !magazordApiSecret) {
      throw new Error('As credenciais da API Magazord não foram configuradas nos segredos.');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from('settings')
      .select('*')
      .eq('singleton_key', 1)
      .single();

    if (settingsError) throw settingsError;

    // --- 1. Busca Contatos da Magazord ---
    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';
    const contactsEndpoint = `${magazordBaseUrl}/contatos`;
    
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
      if (!contact.Email) return false;
      const domain = contact.Email.split('@')[1];
      return domain && !excludedDomains.has(domain.toLowerCase());
    });

    const contactsToProcess = filteredContacts.slice(0, settings.batch_size);
    console.log(`Filtrando e processando um lote de ${contactsToProcess.length} contatos.`);

    let successCount = 0;
    let errorCount = 0;

    for (const contact of contactsToProcess) {
      try {
        // --- 3. Enriquece Contato com Dados de Pedidos ---
        console.log(`Processando contato: ${contact.Email}`);
        const ordersEndpoint = `${magazordBaseUrl}/pedidos?CpfCnpj=${contact.CpfCnpj}`;
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
        } else {
          console.warn(`Não foi possível buscar pedidos para ${contact.CpfCnpj}. Status: ${ordersResponse.status}`);
        }

        contact.total_compras = total_compras;
        contact.valor_total_gasto = valor_total_gasto;

        // --- 4. Adiciona Tags ---
        contact.tags = [];
        if (contact.PessoaFisicaJuridica === 'F') contact.tags.push('Pessoa Física');
        else if (contact.PessoaFisicaJuridica === 'J') contact.tags.push('Pessoa Jurídica');
        
        if (contact.Sexo === 'M') contact.tags.push('Masculino');
        else if (contact.Sexo === 'F') contact.tags.push('Feminino');

        // --- 5. Envia para o Mautic ---
        await pushToMautic(contact);
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(`Falha ao processar o contato ${contact.Email}:`, error.message);
      }
    }

    const message = `Sincronização concluída. Processados: ${contactsToProcess.length}. Sucessos: ${successCount}. Falhas: ${errorCount}.`;
    console.log(message);

    return new Response(
      JSON.stringify({ message }),
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