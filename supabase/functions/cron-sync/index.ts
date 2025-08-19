import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const timestamp = () => `[${new Date().toLocaleTimeString('pt-BR', { hour12: false })}]`;

serve(async (req) => {
  // 1. Verifica o segredo do cron job para segurança
  const authHeader = req.headers.get('Authorization')!
  if (authHeader !== `Bearer ${Deno.env.get('CRON_SECRET')}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 2. Verifica se outra tarefa já está em andamento
    const { data: runningJobs, error: runningJobsError } = await supabaseAdmin
      .from('sync_jobs')
      .select('id')
      .eq('status', 'running');

    if (runningJobsError) throw runningJobsError;
    if (runningJobs && runningJobs.length > 0) {
      console.log("Sync job skipped: another job is already running.");
      await supabaseAdmin.from('sync_jobs').insert({
        status: 'skipped',
        logs: [`${timestamp()} Tarefa automática pulada: uma sincronização já estava em andamento.`],
        finished_at: new Date().toISOString()
      });
      return new Response(JSON.stringify({ success: true, message: 'Job skipped, another is running.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3. Cria um novo registro de job
    const initialLog = `${timestamp()} Tarefa automática iniciada.`;
    const { data: jobData, error: createError } = await supabaseAdmin
      .from('sync_jobs')
      .insert({ status: 'running', full_sync: false, logs: [initialLog] })
      .select('id')
      .single();

    if (createError) throw createError;
    const jobId = jobData.id;

    // 4. Invoca o worker unificado de forma assíncrona
    supabaseAdmin.functions.invoke('unified-sync-worker', {
      body: { jobId, full_sync: false }
    });

    return new Response(JSON.stringify({ success: true, message: 'Unified sync job started.', jobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Failed to start cron-sync job:", error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})