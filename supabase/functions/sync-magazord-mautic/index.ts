import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const timestamp = () => `[${new Date().toLocaleTimeString()}]`;

async function updateJobProgress(
  supabase: SupabaseClient, 
  jobId: string, 
  newLogs: string[], 
  processed: number, 
  total: number,
  status: 'running' | 'completed' | 'failed' = 'running'
) {
  const { error } = await supabase
    .from('sync_jobs')
    .update({ 
      logs: newLogs,
      processed_count: processed,
      total_count: total,
      status: status
    })
    .eq('id', jobId);
  if (error) console.error(`Failed to update job progress for ${jobId}:`, error);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let jobId = '';
  const logs: string[] = [];

  try {
    const { limit = null, jobId: receivedJobId } = await req.json();
    if (!receivedJobId) throw new Error("jobId is required to run a sync.");
    jobId = receivedJobId;

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await supabaseAdmin.from('sync_jobs').update({ status: 'running' }).eq('id', jobId);
    logs.push(`${timestamp()} Job ${jobId} iniciado.`);
    
    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    if (!magazordApiToken || !magazordApiSecret) throw new Error('Credenciais da API Magazord não configuradas.');

    const authHeader = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
    
    const { data: settings, error: settingsError } = await supabaseAdmin.from('settings').select('*').eq('singleton_key', 1).single();
    if (settingsError) throw settingsError;

    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';
    const excludedDomains = new Set(settings.excluded_domains || []);
    
    let currentPage = 1;
    let hasMorePages = true;
    let totalAvailable = 0;
    let totalProcessedInThisRun = 0;
    let totalFailuresInThisRun = 0;

    logs.push(`${timestamp()} Iniciando coleta e processamento de contatos...`);
    await updateJobProgress(supabaseAdmin, jobId, logs, 0, 0);

    while (hasMorePages) {
      const endpoint = `${magazordBaseUrl}/v2/site/pessoa?page=${currentPage}&orderBy=id&orderDirection=asc&limit=100`;
      const response = await fetch(endpoint, { headers: { 'Authorization': authHeader } });
      if (!response.ok) {
        logs.push(`${timestamp()} Aviso: Falha ao buscar página ${currentPage}. Parando.`);
        break;
      }
      const result = await response.json();
      const rawContacts = result.data?.items || [];

      if (currentPage === 1) {
        totalAvailable = result.data?.total || 0;
        logs.push(`${timestamp()} API reporta ${totalAvailable} contatos disponíveis.`);
        await updateJobProgress(supabaseAdmin, jobId, logs, 0, totalAvailable);
      }

      if (rawContacts.length === 0) {
        hasMorePages = false;
        continue;
      }

      logs.push(`${timestamp()} Processando página ${currentPage} com ${rawContacts.length} contatos.`);

      for (const contact of rawContacts) {
        const domain = contact.email?.split('@')[1];
        if (!contact.id || !contact.email || (domain && excludedDomains.has(domain.toLowerCase()))) {
          continue;
        }

        try {
          const magazordContactId = String(contact.id);
          const { data: existingContact } = await supabaseAdmin.from('magazord_contacts').select('id').eq('magazord_id', magazordContactId).single();
          
          if (existingContact) {
            // Se o contato já existe, pulamos o processamento pesado para acelerar.
            // Apenas atualizamos o timestamp para saber que ele foi "visto".
            await supabaseAdmin.from('magazord_contacts').update({ last_processed_at: new Date().toISOString() }).eq('id', existingContact.id);
            continue; // Pula para o próximo contato da página
          }

          // Processamento completo apenas para contatos novos
          const contactData = {
            nome: contact.nome,
            email: contact.email,
            cpf_cnpj: contact.cpfCnpj,
            tipo_pessoa: contact.tipo === 1 ? 'F' : (contact.tipo === 2 ? 'J' : null),
            sexo: contact.sexo,
            last_processed_at: new Date().toISOString(),
          };

          const { data: newDbContact, error: insertError } = await supabaseAdmin
            .from('magazord_contacts')
            .insert({ ...contactData, magazord_id: magazordContactId })
            .select('id')
            .single();
          if (insertError) throw insertError;

          totalProcessedInThisRun++;
        } catch (e) {
          totalFailuresInThisRun++;
          logs.push(`${timestamp()} ERRO ao processar ${contact.email}: ${e.message}`);
        }
      }

      logs.push(`${timestamp()} Fim da página ${currentPage}. Novos contatos salvos: ${totalProcessedInThisRun}.`);
      await updateJobProgress(supabaseAdmin, jobId, logs, totalProcessedInThisRun, totalAvailable);
      currentPage++;

      if (limit && totalProcessedInThisRun >= limit) {
        logs.push(`${timestamp()} Limite de ${limit} contatos atingido. Finalizando.`);
        hasMorePages = false;
      }
    }

    const finalMessage = `Sincronização concluída. Novos contatos salvos: ${totalProcessedInThisRun}. Falhas: ${totalFailuresInThisRun}.`;
    logs.push(`${timestamp()} ${finalMessage}`);
    await supabaseAdmin.from('sync_jobs').update({ status: 'completed', logs, finished_at: new Date().toISOString() }).eq('id', jobId);

    return new Response(JSON.stringify({ success: true, message: "Job completed." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = `Erro fatal na função: ${error.message}`;
    logs.push(`${timestamp()} ${errorMessage}`);
    if (jobId) {
      await supabaseAdmin.from('sync_jobs').update({ status: 'failed', logs, finished_at: new Date().toISOString() }).eq('id', jobId);
    }
    return new Response(JSON.stringify({ success: false, error: { message: errorMessage }, logs }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})