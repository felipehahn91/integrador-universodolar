import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PAGE_LIMIT = 100;

const timestamp = () => `[${new Date().toLocaleTimeString()}]`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Etapa 1: Criar um registro de job imediatamente para rastrear esta execução.
  const { data: job, error: createJobError } = await supabaseAdmin
    .from('sync_jobs')
    .insert({ status: 'running', full_sync: false, logs: [`${timestamp()} Sincronização iniciada.`] })
    .select('id')
    .single();

  if (createJobError) {
    console.error('Falha CRÍTICA ao criar o registro do job:', createJobError);
    // Se não conseguirmos nem criar o registro, não há nada que possamos fazer.
    return new Response(JSON.stringify({ success: false, error: 'Falha ao iniciar o job.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const jobId = job.id;

  try {
    // Etapa 2: Verificar se já existe outra sincronização em andamento.
    const { data: runningJobs, error: runningJobsError } = await supabaseAdmin
      .from('sync_jobs')
      .select('id')
      .eq('status', 'running')
      .neq('id', jobId); // Exclui o job que acabamos de criar.

    if (runningJobsError) {
      throw new Error(`Erro ao verificar jobs em andamento: ${runningJobsError.message}`);
    }

    if (runningJobs && runningJobs.length > 0) {
      // Se outro job estiver rodando, marcamos este como 'pulado' e saímos.
      await supabaseAdmin
        .from('sync_jobs')
        .update({ 
          status: 'skipped', 
          finished_at: new Date().toISOString(),
          logs: [`${timestamp()} Pulado: outra sincronização já estava em andamento.`]
        })
        .eq('id', jobId);
      
      console.log('Sincronização já em progresso. Pulando esta execução.');
      return new Response(JSON.stringify({ success: true, message: 'Sincronização já em progresso. Ignorado.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Etapa 3: Prossiga com a sincronização normal.
    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    if (!magazordApiToken || !magazordApiSecret) throw new Error('Credenciais da API Magazord não configuradas.');

    const authHeader = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';

    let currentPage = 1;
    let newRecordsCount = 0;
    let stopSync = false;

    while (!stopSync) {
      const contactsEndpoint = `${magazordBaseUrl}/v2/site/pessoa?page=${currentPage}&orderBy=id&orderDirection=desc&limit=${PAGE_LIMIT}`;
      const contactsResponse = await fetch(contactsEndpoint, { headers: { 'Authorization': authHeader } });
      if (!contactsResponse.ok) throw new Error(`Falha na API da Magazord na página ${currentPage} com status ${contactsResponse.status}`);
      
      const result = await contactsResponse.json();
      const rawContacts = result.data?.items || [];

      if (rawContacts.length === 0) {
        stopSync = true;
        continue;
      }

      for (const contact of rawContacts) {
        const magazordContactId = String(contact.id);
        
        const { data: existingContact } = await supabaseAdmin
          .from('magazord_contacts')
          .select('id')
          .eq('magazord_id', magazordContactId)
          .maybeSingle();

        if (existingContact) {
          stopSync = true;
          break; 
        }

        const getTelefone = (c: any) => c.pessoaContato?.[0]?.contato || null;

        const contactData = { 
          nome: contact.nome, 
          email: contact.email, 
          cpf_cnpj: contact.cpfCnpj, 
          tipo_pessoa: contact.tipo === 1 ? 'F' : (contact.tipo === 2 ? 'J' : null), 
          sexo: contact.sexo,
          magazord_id: magazordContactId,
          telefone: getTelefone(contact)
        };
        const { data: newContact, error: insertError } = await supabaseAdmin
          .from('magazord_contacts')
          .insert(contactData)
          .select('id, cpf_cnpj')
          .single();

        if (insertError) throw new Error(`Erro ao inserir novo contato: ${insertError.message}`);
        
        newRecordsCount++;

        if (newContact?.cpf_cnpj) {
          try {
            const ordersEndpoint = `${magazordBaseUrl}/v2/site/pedido?cpfCnpj=${newContact.cpf_cnpj}`;
            const ordersResponse = await fetch(ordersEndpoint, { headers: { 'Authorization': authHeader } });
            
            if (ordersResponse.ok) {
              const ordersResult = await ordersResponse.json();
              const orders = ordersResult.data?.items || [];

              if (orders.length > 0) {
                const ordersToInsert = orders.map((order: any) => ({
                  contact_id: newContact.id,
                  magazord_order_id: String(order.id),
                  valor_total: order.valorTotal,
                  status: order.pedidoSituacaoDescricao,
                  status_id: order.pedidoSituacaoId,
                  data_pedido: order.dataHora,
                }));

                await supabaseAdmin.from('magazord_orders').insert(ordersToInsert);

                const totalCompras = orders.length;
                const valorTotalGasto = orders.reduce((sum: number, order: any) => sum + parseFloat(order.valorTotal), 0);

                await supabaseAdmin
                  .from('magazord_contacts')
                  .update({ total_compras: totalCompras, valor_total_gasto: valorTotalGasto })
                  .eq('id', newContact.id);
              }
            }
          } catch (orderError) {
            console.error(`Falha ao buscar pedidos para o contato ${newContact.id}:`, orderError.message);
          }
        }
      }
      
      if (!stopSync) currentPage++;
    }

    const finalLog = `${timestamp()} Sincronização concluída. ${newRecordsCount} novos contatos adicionados.`;
    await supabaseAdmin
      .from('sync_jobs')
      .update({ 
        status: 'completed', 
        finished_at: new Date().toISOString(), 
        new_records_added: newRecordsCount,
        logs: [finalLog]
      })
      .eq('id', jobId);

    return new Response(JSON.stringify({ success: true, message: finalLog }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = `${timestamp()} ERRO: ${error.message}`;
    await supabaseAdmin
      .from('sync_jobs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), logs: [errorMessage] })
      .eq('id', jobId);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})