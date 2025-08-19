import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PAGE_LIMIT = 100;
const timestamp = () => `[${new Date().toLocaleTimeString('pt-BR', { hour12: false })}]`;

const appendLogs = async (supabaseAdmin: any, jobId: string, logs: string[]) => {
  if (!jobId || logs.length === 0) return;
  try {
    const { error } = await supabaseAdmin.rpc('append_logs_to_job', { p_job_id: jobId, p_logs: logs });
    if (error) console.error(`Falha ao registrar log para o job ${jobId}: ${error.message}`);
  } catch (e) { console.error(e.message); }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { page, jobId, totalPages, full_sync } = await req.json();

  try {
    if (!page || !jobId || !totalPages) {
      throw new Error('Parâmetros page, jobId ou totalPages ausentes.');
    }

    const { data: jobStatus } = await supabaseAdmin.from('sync_jobs').select('status').eq('id', jobId).single();
    if (jobStatus?.status !== 'running') {
      return new Response(JSON.stringify({ success: true, message: `Job ${jobId} não está mais em execução. Parando o trabalhador.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    if (!magazordApiToken || !magazordApiSecret) throw new Error('Credenciais da API Magazord não configuradas.');
    const authHeaderMagazord = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';

    let newRecordsCount = 0;
    let stopSync = false;
    let currentLogs: string[] = [];

    const contactsEndpoint = `${magazordBaseUrl}/v2/site/pessoa?page=${page}&orderBy=id&orderDirection=desc&limit=${PAGE_LIMIT}`;
    const contactsResponse = await fetch(contactsEndpoint, { headers: { 'Authorization': authHeaderMagazord } });
    if (!contactsResponse.ok) throw new Error(`Falha na API da Magazord na página ${page} com status ${contactsResponse.status}`);
    const result = await contactsResponse.json();
    const rawContacts = result.data?.items || [];

    if (rawContacts.length === 0) {
      currentLogs.push(`${timestamp()} Nenhuma novo contato encontrado na página ${page}.`);
      stopSync = true;
    } else {
      if (full_sync) {
        currentLogs.push(`${timestamp()} [Full Sync] Buscando contatos na página ${page}.`);
        const contactIds = rawContacts.map(c => String(c.id));
        const { data: existingDbContacts } = await supabaseAdmin.from('magazord_contacts').select('magazord_id').in('magazord_id', contactIds);
        const existingIds = new Set(existingDbContacts?.map(c => c.magazord_id) || []);
        const newContacts = rawContacts.filter(c => !existingIds.has(String(c.id)));

        if (newContacts.length > 0) {
          currentLogs.push(`${timestamp()} Encontrados ${newContacts.length} novos contatos. Inserindo...`);
          const contactsToInsert = newContacts.map(contact => ({
            nome: contact.nome, email: contact.email, cpf_cnpj: contact.cpfCnpj,
            tipo_pessoa: contact.tipo === 1 ? 'F' : (contact.tipo === 2 ? 'J' : null),
            sexo: contact.sexo, magazord_id: String(contact.id),
            telefone: contact.pessoaContato?.[0]?.contato || null
          }));
          const { error: insertError } = await supabaseAdmin.from('magazord_contacts').insert(contactsToInsert);
          if (insertError) { currentLogs.push(`${timestamp()} ERRO ao inserir contatos: ${insertError.message}`); }
          else { newRecordsCount = newContacts.length; currentLogs.push(`${timestamp()} ${newContacts.length} contatos inseridos com sucesso.`); }
        } else {
          currentLogs.push(`${timestamp()} Nenhum contato novo na página ${page}.`);
        }
      } else {
        // Lógica incremental
        currentLogs.push(`${timestamp()} [Incremental Sync] Buscando contatos na página ${page}.`);
        for (const contact of rawContacts) {
          const { data: existingContact } = await supabaseAdmin.from('magazord_contacts').select('id').eq('magazord_id', String(contact.id)).maybeSingle();
          if (existingContact) { stopSync = true; break; }
          const { error: insertError } = await supabaseAdmin.from('magazord_contacts').insert({ nome: contact.nome, email: contact.email, cpf_cnpj: contact.cpfCnpj, tipo_pessoa: contact.tipo === 1 ? 'F' : (contact.tipo === 2 ? 'J' : null), sexo: contact.sexo, magazord_id: String(contact.id), telefone: contact.pessoaContato?.[0]?.contato || null });
          if (insertError) { currentLogs.push(`${timestamp()} ERRO ao inserir contato ${contact.id}: ${insertError.message}`); }
          else { newRecordsCount++; }
        }
        if(stopSync) currentLogs.push(`${timestamp()} Contato existente encontrado. Encerrando busca incremental.`);
      }
    }

    await appendLogs(supabaseAdmin, jobId, currentLogs);
    await supabaseAdmin.sql`UPDATE sync_jobs SET new_records_added = new_records_added + ${newRecordsCount}, last_processed_page = ${page} WHERE id = ${jobId}`;

    if (!stopSync && page < totalPages) {
      await supabaseAdmin.functions.invoke('sync-worker', {
        body: { page: page + 1, jobId, totalPages, full_sync }
      });
    } else {
      await appendLogs(supabaseAdmin, jobId, [`${timestamp()} Sincronização de contatos concluída.`]);
      await supabaseAdmin.from('sync_jobs').update({ status: 'completed', finished_at: new Date().toISOString() }).eq('id', jobId);
    }

    return new Response(JSON.stringify({ success: true, message: `Página ${page} processada.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = `${timestamp()} ERRO FATAL na página ${page}: ${error.message}`;
    await appendLogs(supabaseAdmin, jobId, [errorMessage]);
    await supabaseAdmin.from('sync_jobs').update({ status: 'failed', finished_at: new Date().toISOString() }).eq('id', jobId);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})