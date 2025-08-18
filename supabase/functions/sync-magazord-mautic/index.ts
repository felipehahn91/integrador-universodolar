import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH_SIZE = 10; // Processa 10 páginas por execução para evitar timeouts

const timestamp = () => `[${new Date().toLocaleTimeString()}]`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let jobId = '';
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const { limit = null, jobId: receivedJobId } = await req.json();
    if (!receivedJobId) throw new Error("jobId é obrigatório para rodar a sincronização.");
    jobId = receivedJobId;

    const { data: jobData, error: jobFetchError } = await supabaseAdmin
      .from('sync_jobs')
      .select('last_processed_page, logs, full_sync')
      .eq('id', jobId)
      .single();

    if (jobFetchError) throw jobFetchError;

    // Se um trabalho já está rodando, saia para evitar execuções paralelas. O scheduler tentará novamente.
    const { data: runningCheck } = await supabaseAdmin.from('sync_jobs').select('status').eq('id', jobId).single();
    if (runningCheck?.status === 'running') {
      console.warn(`Trabalho ${jobId} já está em execução. Pulando esta invocação.`);
      return new Response(JSON.stringify({ success: true, message: "Job already running." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const logs = jobData.logs || [];
    logs.push(`${timestamp()} Lote iniciado para o Job ${jobId}.`);
    await supabaseAdmin.from('sync_jobs').update({ status: 'running', logs }).eq('id', jobId);
    
    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    if (!magazordApiToken || !magazordApiSecret) throw new Error('Credenciais da API Magazord não configuradas.');

    const authHeader = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
    const { data: settings, error: settingsError } = await supabaseAdmin.from('settings').select('*').eq('singleton_key', 1).single();
    if (settingsError) throw settingsError;

    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';
    const excludedDomains = new Set(settings.excluded_domains || []);
    
    let currentPage = (jobData.last_processed_page || 0) + 1;
    let pagesProcessedInBatch = 0;
    let totalAvailable = 0;

    while (pagesProcessedInBatch < BATCH_SIZE) {
      const endpoint = `${magazordBaseUrl}/v2/site/pessoa?page=${currentPage}&orderBy=id&orderDirection=asc&limit=100`;
      const response = await fetch(endpoint, { headers: { 'Authorization': authHeader } });
      if (!response.ok) throw new Error(`Falha na API da Magazord na página ${currentPage} com status ${response.status}`);
      
      const result = await response.json();
      const rawContacts = result.data?.items || [];
      totalAvailable = result.data?.total || totalAvailable;

      if (rawContacts.length === 0) {
        logs.push(`${timestamp()} Fim de todos os contatos. Sincronização concluída.`);
        await supabaseAdmin.from('sync_jobs').update({ status: 'completed', logs, finished_at: new Date().toISOString(), total_count: totalAvailable }).eq('id', jobId);
        return new Response(JSON.stringify({ success: true, message: "Job completed." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      logs.push(`${timestamp()} Processando página ${currentPage} com ${rawContacts.length} contatos.`);
      
      for (const contact of rawContacts) {
        const domain = contact.email?.split('@')[1];
        if (!contact.id || !contact.email || (domain && excludedDomains.has(domain.toLowerCase()))) continue;
        
        const magazordContactId = String(contact.id);
        const { data: existingContact } = await supabaseAdmin.from('magazord_contacts').select('id').eq('magazord_id', magazordContactId).single();
        
        if (existingContact) {
          await supabaseAdmin.from('magazord_contacts').update({ last_processed_at: new Date().toISOString() }).eq('id', existingContact.id);
        } else {
          const contactData = { nome: contact.nome, email: contact.email, cpf_cnpj: contact.cpfCnpj, tipo_pessoa: contact.tipo === 1 ? 'F' : (contact.tipo === 2 ? 'J' : null), sexo: contact.sexo, last_processed_at: new Date().toISOString() };
          await supabaseAdmin.from('magazord_contacts').insert({ ...contactData, magazord_id: magazordContactId });
        }
      }

      await supabaseAdmin.from('sync_jobs').update({ last_processed_page: currentPage, total_count: totalAvailable, logs }).eq('id', jobId);
      
      pagesProcessedInBatch++;
      currentPage++;

      // Se for uma sincronização manual (com limite), respeite o limite.
      if (!jobData.full_sync && limit && pagesProcessedInBatch * 100 >= limit) {
        logs.push(`${timestamp()} Limite manual de ${limit} contatos atingido.`);
        await supabaseAdmin.from('sync_jobs').update({ status: 'completed', logs, finished_at: new Date().toISOString() }).eq('id', jobId);
        return new Response(JSON.stringify({ success: true, message: "Job completed." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    logs.push(`${timestamp()} Fim do lote. O scheduler continuará o trabalho.`);
    await supabaseAdmin.from('sync_jobs').update({ status: 'pending', logs }).eq('id', jobId); // Volta para 'pending' para o scheduler pegar de novo

    return new Response(JSON.stringify({ success: true, message: "Batch completed." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const { data: jobData } = await supabaseAdmin.from('sync_jobs').select('logs').eq('id', jobId).single();
    const logs = jobData?.logs || [];
    const errorMessage = `Erro no lote: ${error.message}. O scheduler tentará novamente em breve.`;
    logs.push(`${timestamp()} ${errorMessage}`);
    if (jobId) {
      await supabaseAdmin.from('sync_jobs').update({ status: 'failed', logs }).eq('id', jobId);
    }
    return new Response(JSON.stringify({ success: false, error: { message: errorMessage } }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})