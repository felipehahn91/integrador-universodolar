import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH_SIZE = 25;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
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

    const { count, error: countError } = await supabaseAdmin.from('magazord_contacts').select('*', { count: 'exact', head: true });
    if (countError) throw countError;
    if (!count || count === 0) {
      return new Response(JSON.stringify({ success: true, message: "Nenhum contato para processar." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const totalPages = Math.ceil(count / BATCH_SIZE);
    const jobName = "Sincronização com Mautic";
    const initialLog = `[${new Date().toLocaleTimeString()}] Tarefa manual '${jobName}' iniciada. Total de ${count} contatos em ${totalPages} lotes.`;

    const { data: jobData, error: createError } = await supabaseAdmin
      .from('sync_jobs')
      .insert({ user_id: user.id, status: 'running', full_sync: true, logs: [initialLog], total_count: count })
      .select('id')
      .single();
    if (createError) throw createError;
    const jobId = jobData.id;

    // Inicia o primeiro lote de forma assíncrona (fire-and-forget)
    supabaseAdmin.functions.invoke('mautic-backfill-worker', {
      body: { page: 1, jobId, totalPages }
    });

    return new Response(JSON.stringify({ success: true, message: 'Tarefa de sincronização em massa iniciada com sucesso.', jobId }), {
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