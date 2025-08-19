import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

const PAGE_LIMIT = 100;
const timestamp = () => `[${new Date().toLocaleTimeString()}]`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const cronSecret = Deno.env.get('CRON_SECRET');
  const requestSecret = req.headers.get('x-cron-secret');
  if (!cronSecret || requestSecret !== cronSecret) {
    return new Response(JSON.stringify({ success: false, error: 'Não autorizado.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: job, error: createJobError } = await supabaseAdmin
    .from('sync_jobs')
    .insert({ status: 'running', full_sync: false, logs: [`${timestamp()} Sincronização iniciada.`] })
    .select('id')
    .single();

  if (createJobError) {
    console.error('Falha CRÍTICA ao criar o registro do job:', createJobError);
    return new Response(JSON.stringify({ success: false, error: 'Falha ao iniciar o job.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const jobId = job.id;

  try {
    const { data: runningJobs } = await supabaseAdmin
      .from('sync_jobs')
      .select('id')
      .eq('status', 'running')
      .neq('id', jobId);

    if (runningJobs && runningJobs.length > 0) {
      await supabaseAdmin
        .from('sync_jobs')
        .update({ status: 'skipped', finished_at: new Date().toISOString(), logs: [`${timestamp()} Pulado: outra sincronização já estava em andamento.`] })
        .eq('id', jobId);
      return new Response(JSON.stringify({ success: true, message: 'Sincronização já em progresso. Ignorado.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    if (!magazordApiToken || !magazordApiSecret) throw new Error('Credenciais da API Magazord não configuradas.');
    const authHeader = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';

    // --- Etapa 1: Sincronizar Novos Contatos ---
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
        const { data: existingContact } = await supabaseAdmin.from('magazord_contacts').select('id').eq('magazord_id', String(contact.id)).maybeSingle();
        if (existingContact) {
          stopSync = true;
          break; 
        }

        const contactData = { 
          nome: contact.nome, email: contact.email, cpf_cnpj: contact.cpfCnpj, 
          tipo_pessoa: contact.tipo === 1 ? 'F' : (contact.tipo === 2 ? 'J' : null), 
          sexo: contact.sexo, magazord_id: String(contact.id), telefone: contact.pessoaContato?.[0]?.contato || null
        };
        const { data: newContact, error: insertError } = await supabaseAdmin.from('magazord_contacts').insert(contactData).select('id, cpf_cnpj').single();
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
                const ordersToInsert = orders.map((o: any) => ({ contact_id: newContact.id, magazord_order_id: String(o.id), valor_total: o.valorTotal, status: o.pedidoSituacaoDescricao, status_id: o.pedidoSituacaoId, data_pedido: o.dataHora }));
                await supabaseAdmin.from('magazord_orders').insert(ordersToInsert);
                const totalCompras = orders.length;
                const valorTotalGasto = orders.reduce((sum: number, o: any) => sum + parseFloat(o.valorTotal), 0);
                await supabaseAdmin.from('magazord_contacts').update({ total_compras: totalCompras, valor_total_gasto: valorTotalGasto }).eq('id', newContact.id);
              }
            }
          } catch (orderError) { console.error(`Falha ao buscar pedidos para o contato ${newContact.id}:`, orderError.message); }
        }
      }
      if (!stopSync) currentPage++;
    }

    // --- Etapa 2: Atualizar Status de Pedidos Existentes ---
    let updatedOrdersCount = 0;
    const FINAL_STATUSES = ['Cancelado', 'Entregue', 'Pedido Entregue']; 
    const BATCH_SIZE_ORDERS = 100;

    const { data: ordersToUpdate, error: fetchError } = await supabaseAdmin.from('magazord_orders').select('id, magazord_order_id, status').not('status', 'in', `(${FINAL_STATUSES.map(s => `'${s}'`).join(',')})`).limit(BATCH_SIZE_ORDERS);
    if (fetchError) { console.error("Erro ao buscar pedidos para atualização:", fetchError.message); }
    
    if (ordersToUpdate && ordersToUpdate.length > 0) {
      for (const order of ordersToUpdate) {
        try {
          const orderEndpoint = `${magazordBaseUrl}/v2/site/pedido/${order.magazord_order_id}`;
          const response = await fetch(orderEndpoint, { headers: { 'Authorization': authHeader } });
          if (!response.ok) continue;
          const result = await response.json();
          const orderDetails = result.data;
          if (!orderDetails) continue;
          const newStatus = orderDetails.pedidoSituacaoDescricao;
          const newStatusId = orderDetails.pedidoSituacaoId;
          if (newStatus && newStatus !== order.status) {
            await supabaseAdmin.from('magazord_orders').update({ status: newStatus, status_id: newStatusId }).eq('id', order.id);
            updatedOrdersCount++;
          }
        } catch (apiError) { console.error(`Erro ao processar o pedido ${order.magazord_order_id}:`, apiError.message); }
      }
    }

    // --- Etapa Final: Registrar Conclusão do Job ---
    const finalLog = `${timestamp()} Sincronização concluída. ${newRecordsCount} novos contatos. ${updatedOrdersCount} pedidos atualizados.`;
    await supabaseAdmin
      .from('sync_jobs')
      .update({ 
        status: 'completed', 
        finished_at: new Date().toISOString(), 
        new_records_added: newRecordsCount,
        orders_status_updated_count: updatedOrdersCount
      })
      .eq('id', jobId);

    return new Response(JSON.stringify({ success: true, message: finalLog }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = `${timestamp()} ERRO: ${error.message}`;
    await supabaseAdmin.from('sync_jobs').update({ status: 'failed', finished_at: new Date().toISOString(), logs: [errorMessage] }).eq('id', jobId);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})