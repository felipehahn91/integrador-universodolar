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
  if (!response.ok) throw new Error(`Falha ao obter token do Mautic: ${response.status} ${await response.text()}`);
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const { jobId, full_sync = false, page = 1 } = await req.json();
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
      await appendLogs(supabaseAdmin, jobId, [`${timestamp()} Worker unificado iniciado (Full Sync: ${full_sync}).`]);
      await appendLogs(supabaseAdmin, jobId, [`${timestamp()} Passo 1: Buscando novos contatos na Magazord...`]);
    }

    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    const authHeaderMagazord = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';
    
    const contactsEndpoint = `${magazordBaseUrl}/v2/site/pessoa?page=${page}&orderBy=id&orderDirection=desc&limit=50`;
    const response = await fetch(contactsEndpoint, { headers: { 'Authorization': authHeaderMagazord } });
    if (!response.ok) throw new Error(`API Magazord (Contatos) falhou na página ${page}: ${response.status}`);
    const result = await response.json();
    const contacts = result.data?.items || [];
    
    await appendLogs(supabaseAdmin, jobId, [`${timestamp()}  - Página ${page}: ${contacts.length} contatos recebidos da Magazord.`]);

    let newContactsInPage = 0;
    let foundExistingInIncremental = false;
    const contactsToSyncWithMautic = new Set<string>();

    if (contacts.length > 0) {
      const magazordIdsInBatch = contacts.map((c: any) => String(c.id));
      const { data: existingContacts, error: existingError } = await supabaseAdmin.from('magazord_contacts').select('magazord_id').in('magazord_id', magazordIdsInBatch);
      if (existingError) throw existingError;

      const existingMagazordIds = new Set(existingContacts.map(c => c.magazord_id));
      const newContactsToInsert = [];

      for (const contact of contacts) {
        const magazordId = String(contact.id);
        if (existingMagazordIds.has(magazordId)) {
          if (!full_sync) { foundExistingInIncremental = true; }
          continue;
        }
        newContactsToInsert.push({
          nome: contact.nome, email: contact.email, cpf_cnpj: contact.cpfCnpj,
          tipo_pessoa: contact.tipo === 1 ? 'F' : 'J', sexo: contact.sexo,
          magazord_id: magazordId, telefone: contact.pessoaContato?.[0]?.contato || null
        });
      }

      if (newContactsToInsert.length > 0) {
        const { data: insertedContacts, error: insertError } = await supabaseAdmin.from('magazord_contacts').insert(newContactsToInsert).select('id');
        if (insertError) {
          await appendLogs(supabaseAdmin, jobId, [`${timestamp()}  - ERRO ao inserir lote de contatos: ${insertError.message}`]);
        } else {
          newContactsInPage = insertedContacts.length;
          for (const newContact of insertedContacts) { contactsToSyncWithMautic.add(newContact.id); }
          await appendLogs(supabaseAdmin, jobId, [`${timestamp()}  - ${newContactsInPage} novos contatos inseridos no banco.`]);
          await supabaseAdmin.rpc('increment_job_counts', { p_job_id: jobId, p_new_records: newContactsInPage, p_page_number: page });
        }
      }
    }

    const shouldContinueFetching = contacts.length > 0 && (full_sync || !foundExistingInIncremental);

    if (shouldContinueFetching) {
      await supabaseAdmin.functions.invoke('unified-sync-worker', { body: { jobId, full_sync, page: page + 1 } });
      return new Response(JSON.stringify({ success: true, message: `Página ${page} processada, próxima página agendada.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      await appendLogs(supabaseAdmin, jobId, [`${timestamp()} Passo 1 concluído. Finalizando busca de contatos.`]);

      const mauticUrl = Deno.env.get('MAUTIC_URL');
      const mauticClientId = Deno.env.get('MAUTIC_CLIENT_ID');
      const mauticClientSecret = Deno.env.get('MAUTIC_CLIENT_SECRET');
      const mauticToken = await getMauticToken(mauticUrl, mauticClientId, mauticClientSecret);
      const mauticHeaders = { 'Authorization': `Bearer ${mauticToken}`, 'Content-Type': 'application/json' };
      let updatedOrdersCount = 0;

      await appendLogs(supabaseAdmin, jobId, [`${timestamp()} Passo 2: Buscando e atualizando pedidos...`]);
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: contactsForOrderCheck, error: contactsForOrderCheckError } = await supabaseAdmin
        .from('magazord_contacts')
        .select('id, cpf_cnpj')
        .or(`created_at.gte.${yesterday},last_processed_at.gte.${yesterday}`);
      if (contactsForOrderCheckError) throw contactsForOrderCheckError;

      for (const contact of contactsForOrderCheck) {
        if (!contact.cpf_cnpj) continue;
        contactsToSyncWithMautic.add(contact.id);
        
        const ordersEndpoint = `${magazordBaseUrl}/v2/site/pedido?cpfCnpj=${contact.cpf_cnpj}`;
        const ordersResponse = await fetch(ordersEndpoint, { headers: { 'Authorization': authHeaderMagazord } });
        if (!ordersResponse.ok) {
          await appendLogs(supabaseAdmin, jobId, [`${timestamp()}  - AVISO: Falha ao buscar pedidos para ${contact.cpf_cnpj}: ${ordersResponse.status}`]);
          continue;
        }
        const ordersResult = await ordersResponse.json();
        const orders = ordersResult.data?.items || [];

        if (orders.length > 0) {
          const ordersToUpsert = orders.map((o: any) => ({
            contact_id: contact.id, magazord_order_id: String(o.id), valor_total: o.valorTotal,
            status: o.pedidoSituacaoDescricao, status_id: o.pedidoSituacaoId, data_pedido: o.dataHora,
          }));
          const { error: upsertError } = await supabaseAdmin.from('magazord_orders').upsert(ordersToUpsert, { onConflict: 'magazord_order_id' });
          if (upsertError) {
            await appendLogs(supabaseAdmin, jobId, [`${timestamp()}  - ERRO ao atualizar pedidos para ${contact.cpf_cnpj}: ${upsertError.message}`]);
          } else {
            updatedOrdersCount += orders.length;
            const totalCompras = orders.length;
            const valorTotalGasto = orders.reduce((sum: number, o: any) => sum + parseFloat(o.valorTotal), 0);
            await supabaseAdmin.from('magazord_contacts').update({ total_compras: totalCompras, valor_total_gasto: valorTotalGasto, last_processed_at: new Date().toISOString() }).eq('id', contact.id);
          }
        }
      }
      await supabaseAdmin.from('sync_jobs').update({ orders_status_updated_count: updatedOrdersCount }).eq('id', jobId);
      await appendLogs(supabaseAdmin, jobId, [`${timestamp()} Passo 2 concluído. ${updatedOrdersCount} pedidos verificados/atualizados.`]);

      await appendLogs(supabaseAdmin, jobId, [`${timestamp()} Passo 3 & 4: Sincronizando ${contactsToSyncWithMautic.size} contatos com Mautic...`]);
      const contactIds = Array.from(contactsToSyncWithMautic);
      
      for (const contactId of contactIds) {
        const { data: contact, error: contactError } = await supabaseAdmin.from('magazord_contacts').select('*').eq('id', contactId).single();
        if (contactError || !contact || !contact.email) continue;

        const { data: latestOrder } = await supabaseAdmin.from('magazord_orders').select('status').eq('contact_id', contact.id).order('data_pedido', { ascending: false }).limit(1).single();
        const newTag = latestOrder ? getMauticTagForStatus(latestOrder.status) : null;

        const nomeParts = (contact.nome || '').split(' ').filter(Boolean);
        const contactPayload: any = {
          firstname: nomeParts[0] || '', lastname: nomeParts.slice(1).join(' ') || '',
          email: contact.email, idmagazord: String(contact.magazord_id), company: "Universo do Lar",
        };
        if (newTag) {
          contactPayload.tags = [{ tag: newTag }];
        }

        try {
          const searchUrl = `${mauticUrl}/api/contacts?search=idmagazord:${contact.magazord_id}`;
          const searchResponse = await fetch(searchUrl, { headers: mauticHeaders });
          const searchResult = await searchResponse.json();

          if (searchResult.total > 0) {
            const mauticContactId = Object.keys(searchResult.contacts)[0];
            const updateUrl = `${mauticUrl}/api/contacts/${mauticContactId}/edit`;
            const updateResponse = await fetch(updateUrl, { method: 'PATCH', headers: mauticHeaders, body: JSON.stringify(contactPayload) });
            if (!updateResponse.ok) throw new Error(`Falha ao ATUALIZAR: ${await updateResponse.text()}`);
          } else {
            const createUrl = `${mauticUrl}/api/contacts/new`;
            const createResponse = await fetch(createUrl, { method: 'POST', headers: mauticHeaders, body: JSON.stringify(contactPayload) });
            if (!createResponse.ok) throw new Error(`Falha ao CRIAR: ${await createResponse.text()}`);
          }
        } catch (mauticError) {
          await appendLogs(supabaseAdmin, jobId, [`${timestamp()}  - ERRO Mautic para ${contact.email}: ${mauticError.message}`]);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      await appendLogs(supabaseAdmin, jobId, [`${timestamp()} Passo 3 & 4 concluído.`]);

      await supabaseAdmin.from('sync_jobs').update({ status: 'completed', finished_at: new Date().toISOString() }).eq('id', jobId);
      await appendLogs(supabaseAdmin, jobId, [`${timestamp()} Sincronização unificada concluída com sucesso.`]);

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    await appendLogs(supabaseAdmin, jobId, [`${timestamp()} ERRO FATAL: ${error.message}`]);
    await supabaseAdmin.from('sync_jobs').update({ status: 'failed', finished_at: new Date().toISOString() }).eq('id', jobId);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Tfype': 'application/json' } });
  }
});