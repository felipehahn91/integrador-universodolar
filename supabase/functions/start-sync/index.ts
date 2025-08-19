import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const timestamp = () => `[${new Date().toLocaleTimeString('pt-BR', { hour12: false })}]`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { full_sync = false } = await req.json().catch(() => ({}));

    const authHeader = req.headers.get('Authorization')!
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await supabaseClient.auth.getUser()
    if (!user) throw new Error('Usuário não autenticado.')

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: runningJobs, error: runningJobsError } = await supabaseAdmin
      .from('sync_jobs')
      .select('id')
      .eq('status', 'running');

    if (runningJobsError) throw runningJobsError;
    if (runningJobs && runningJobs.length > 0) {
      throw new Error("Uma tarefa de sincronização já está em andamento. Por favor, aguarde a sua conclusão.");
    }

    const initialLog = `${timestamp()} Tarefa manual '${full_sync ? 'Sincronização Completa' : 'Sincronização Unificada'}' iniciada.`;
    const { data: jobData, error: createError } = await supabaseAdmin
      .from('sync_jobs')
      .insert({ user_id: user.id, status: 'running', full_sync, logs: [initialLog] })
      .select('id')
      .single();
    if (createError) throw createError;
    const jobId = jobData.id;

    // Invoca o worker unificado para a primeira página
    supabaseAdmin.functions.invoke('unified-sync-worker', {
      body: { jobId, full_sync, page: 1 }
    });

    return new Response(JSON.stringify({ success: true, message: 'Tarefa de sincronização iniciada com sucesso.', jobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})