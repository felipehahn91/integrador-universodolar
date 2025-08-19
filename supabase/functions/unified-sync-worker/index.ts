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

    if (contacts.length > 0) {
      const magazordIdsInBatch = contacts.map((c: any) => String(c.id));
      const { data: existingContacts, error: existingError } = await supabaseAdmin.from('magazord_contacts').select('magazord_id').in('magazord_id', magazordIdsInBatch);
      if (existingError) throw existingError;

      if (!full_sync && existingContacts.length > 0) {
        foundExistingInIncremental = true;
        await appendLogs(supabaseAdmin, jobId, [`${timestamp()}  - Contato existente encontrado. A busca por novos contatos será interrompida.`]);
      }

      const existingMagazordIds = new Set(existingContacts.map(c => c.magazord_id));
      const newContactsToInsert = contacts
        .filter((contact: any) => !existingMagazordIds.has(String(contact.id)))
        .map((contact: any) => ({
          nome: contact.nome, email: contact.email, cpf_cnpj: contact.cpfCnpj,
          tipo_pessoa: contact.tipo === 1 ? 'F' : 'J', sexo: contact.sexo,
          magazord_id: String(contact.id), telefone: contact.pessoaContato?.[0]?.contato || null
        }));

      if (newContactsToInsert.length > 0) {
        const { error: insertError } = await supabaseAdmin.from('magazord_contacts').insert(newContactsToInsert);
        if (insertError) {
          await appendLogs(supabaseAdmin, jobId, [`${timestamp()}  - ERRO ao inserir lote de contatos: ${insertError.message}`]);
        } else {
          newContactsInPage = newContactsToInsert.length;
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
      
      await supabaseAdmin.functions.invoke('process-updates-worker', {
        body: { jobId, page: 1 }
      });

      return new Response(JSON.stringify({ success: true, message: 'Busca de contatos finalizada. Iniciando processamento de atualizações.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (error) {
    await appendLogs(supabaseAdmin, jobId, [`${timestamp()} ERRO FATAL: ${error.message}`]);
    await supabaseAdmin.from('sync_jobs').update({ status: 'failed', finished_at: new Date().toISOString() }).eq('id', jobId);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});