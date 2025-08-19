import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const timestamp = () => `[${new Date().toLocaleTimeString('pt-BR', { hour12: false })}]`;

const appendLogs = async (supabase: SupabaseClient, jobId: string, logs: string[]) => {
  if (!jobId || logs.length === 0) return;
  await supabase.rpc('append_logs_to_job', { p_job_id: jobId, p_logs: logs });
};

const getMauticToken = async (mauticUrl: string, clientId: string, clientSecret: string) => {
  const tokenUrl = `${mauticUrl}/oauth/v2/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Falha ao obter token do Mautic: ${response.status} ${errorBody}`);
  }
  return (await response.json()).access_token;
};

const getMauticTagForStatus = (status: string): string | null => {
  const s = status.toLowerCase();
  if (s.includes('aguardando pagamento') || s.includes('análise de pagamento')) return 'pedido-aguardando-pagamento';
  if (s.includes('aprovado') || s.includes('nota fiscal emitida') || s.includes('em transporte')) return 'pedido-em-processamento';
  if (s.includes('entregue')) return 'pedido-entregue';
  if (s.includes('cancelado')) return 'pedido-cancelado';
  return null;
};

const BATCH_SIZE = 50; // Aumentado o tamanho do lote

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const { jobId, page = 1 } = await req.json();
  if (!jobId) {
    return new Response(JSON.stringify({ error: 'jobId é obrigatório.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const { data: jobStatusCheck } = await supabaseAdmin.from('sync_jobs').select('status').eq('id', jobId).single();
    if (jobStatusCheck?.status === 'cancelled' || jobStatusCheck?.status === 'failed') {
      return new Response(JSON.stringify({ success: true, message: 'Job was cancelled or failed.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (page === 1) {
      await appendLogs(supabaseAdmin, jobId, [`${timestamp()} Passo 2: Iniciando atualização de pedidos e sincronização com Mautic em lotes.`]);
    }

    const from = (page - 1) * BATCH_SIZE;
    const to = from + BATCH_SIZE - 1;

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: contactsToProcess, error: contactsError } = await supabaseAdmin
      .from('magazord_contacts')
      .select('*')
      .or(`created_at.gte.${yesterday},last_processed_at.is.null,last_processed_at.lt.${yesterday}`)
      .order('created_at', { ascending: true })
      .range(from, to);

    if (contactsError) throw contactsError;

    await appendLogs(supabaseAdmin, jobId, [`${timestamp()}  - Lote ${page}: Processando ${contactsToProcess.length} contatos.`]);

    if (contactsToProcess.length > 0) {
      const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
      const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
      const authHeaderMagazord = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
      const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';

      const mauticUrl = Deno.env.get('MAUTIC_URL');
      const mauticClientId = Deno.env.get('MAUTIC_CLIENT_ID');
      const mauticClientSecret = Deno.env.get('MAUTIC_CLIENT_SECRET');
      const mauticToken = await getMauticToken(mauticUrl, mauticClientId, mauticClientSecret);
      const mauticHeaders = { 'Authorization': `Bearer ${mauticToken}`, 'Content-Type': 'application/json' };
      
      let updatedOrdersCount = 0;

      // Atualização de pedidos ainda é individual, pois depende do CPF/CNPJ
      for (const contact of contactsToProcess) {
        if (contact.cpf_cnpj) {
          const ordersEndpoint = `${magazordBaseUrl}/v2/site/pedido?cpfCnpj=${contact.cpf_cnpj}`;
          const ordersResponse = await fetch(ordersEndpoint, { headers: { 'Authorization': authHeaderMagazord } });
          if (ordersResponse.ok) {
            const ordersResult = await ordersResponse.json();
            const orders = ordersResult.data?.items || [];
            if (orders.length > 0) {
              const ordersToUpsert = orders.map((o: any) => ({
                contact_id: contact.id, magazord_order_id: String(o.id), valor_total: o.valorTotal,
                status: o.pedidoSituacaoDescricao, status_id: o.pedidoSituacaoId, data_pedido: o.dataHora,
              }));
              const { error: upsertError } = await supabaseAdmin.from('magazord_orders').upsert(ordersToUpsert, { onConflict: 'magazord_order_id' });
              if (!upsertError) {
                updatedOrdersCount += orders.length;
                const totalCompras = orders.length;
                const valorTotalGasto = orders.reduce((sum: number, o: any) => sum + parseFloat(o.valorTotal), 0);
                await supabaseAdmin.from('magazord_contacts').update({ total_compras: totalCompras, valor_total_gasto: valorTotalGasto, last_processed_at: new Date().toISOString() }).eq('id', contact.id);
              }
            }
          }
        }
      }
      await supabaseAdmin.from('sync_jobs').update({ orders_status_updated_count: updatedOrdersCount }).eq('id', jobId);
      
      // Sincronização com Mautic em lote
      const validContacts = contactsToProcess.filter(c => c.email);
      
      const existingMauticContacts = new Map<string, number>();
      const MAUTIC_SEARCH_CHUNK_SIZE = 10; // Search 10 emails at a time

      for (let i = 0; i < validContacts.length; i += MAUTIC_SEARCH_CHUNK_SIZE) {
        const chunk = validContacts.slice(i, i + MAUTIC_SEARCH_CHUNK_SIZE);
        const emailsToSearch = chunk.map(c => c.email);
        
        const searchUrl = `${mauticUrl}/api/contacts?search=${emailsToSearch.map(e => `email:${encodeURIComponent(e)}`).join(' or ')}&limit=${chunk.length}`;
        const searchResponse = await fetch(searchUrl, { headers: mauticHeaders });
        if (!searchResponse.ok) {
            const errorText = await searchResponse.text();
            throw new Error(`Falha ao buscar contatos em lote no Mautic: ${errorText}`);
        }
        const searchResult = await searchResponse.json();
        
        Object.values(searchResult.contacts || {}).forEach((c: any) => {
            existingMauticContacts.set(c.fields.core.email.value, c.id);
        });
      }
      
      const contactsToCreate = [];
      const contactsToUpdate: { [key: string]: any } = {};

      for (const contact of validContacts) {
        const { data: latestOrder } = await supabaseAdmin.from('magazord_orders').select('status').eq('contact_id', contact.id).order('data_pedido', { ascending: false }).limit(1).single();
        const newTag = latestOrder ? getMauticTagForStatus(latestOrder.status) : null;
        const nomeParts = (contact.nome || '').split(' ').filter(Boolean);
        
        const payload = {
          firstname: nomeParts[0] || '',
          lastname: nomeParts.slice(1).join(' ') || '',
          email: contact.email,
          idmagazord: String(contact.magazord_id),
          company: "Universo do Lar",
          tags: newTag ? [newTag] : [],
        };

        const mauticId = existingMauticContacts.get(contact.email);
        if (mauticId) {
          contactsToUpdate[mauticId] = payload;
        } else {
          contactsToCreate.push(payload);
        }
      }

      if (contactsToCreate.length > 0) {
        const createUrl = `${mauticUrl}/api/contacts/batch/new`;
        const createResponse = await fetch(createUrl, { method: 'POST', headers: mauticHeaders, body: JSON.stringify(contactsToCreate) });
        if (!createResponse.ok) throw new Error(`Falha ao criar contatos em lote: ${await createResponse.text()}`);
        await appendLogs(supabaseAdmin, jobId, [`${timestamp()}  - Sucesso: ${contactsToCreate.length} contatos criados em lote no Mautic.`]);
      }

      if (Object.keys(contactsToUpdate).length > 0) {
        const updateUrl = `${mauticUrl}/api/contacts/batch/edit`;
        const updateResponse = await fetch(updateUrl, { method: 'PATCH', headers: mauticHeaders, body: JSON.stringify(contactsToUpdate) });
        if (!updateResponse.ok) throw new Error(`Falha ao atualizar contatos em lote: ${await updateResponse.text()}`);
        await appendLogs(supabaseAdmin, jobId, [`${timestamp()}  - Sucesso: ${Object.keys(contactsToUpdate).length} contatos atualizados em lote no Mautic.`]);
      }
    }

    if (contactsToProcess.length === BATCH_SIZE) {
      await supabaseAdmin.functions.invoke('process-updates-worker', { body: { jobId, page: page + 1 } });
      return new Response(JSON.stringify({ success: true, message: `Lote ${page} processado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      await appendLogs(supabaseAdmin, jobId, [`${timestamp()} Sincronização unificada concluída com sucesso.`]);
      await supabaseAdmin.from('sync_jobs').update({ status: 'completed', finished_at: new Date().toISOString() }).eq('id', jobId);
      return new Response(JSON.stringify({ success: true, message: 'Job finalizado.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    await appendLogs(supabaseAdmin, jobId, [`${timestamp()} ERRO FATAL: ${error.message}`]);
    await supabaseAdmin.from('sync_jobs').update({ status: 'failed', finished_at: new Date().toISOString() }).eq('id', jobId);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});