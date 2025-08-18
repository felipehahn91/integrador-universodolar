import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (_req) => {
  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Encontra o trabalho de "Sincronizar Tudo" mais recente que não foi concluído.
    const { data: job, error: jobError } = await supabaseAdmin
      .from('sync_jobs')
      .select('id, status')
      .eq('full_sync', true)
      .neq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (jobError) {
      // Se o erro for 'PGRST116', significa que não há trabalhos pendentes, o que é normal.
      if (jobError.code === 'PGRST116') {
        return new Response(JSON.stringify({ success: true, message: "Nenhum trabalho de sincronização total pendente." }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw jobError;
    }

    // 2. Se houver um trabalho pendente ou falho, invoca a função trabalhadora para processar o próximo lote.
    if (job) {
      console.log(`Scheduler encontrou o trabalho ${job.id} com status ${job.status}. Invocando o trabalhador.`);
      const { error: invokeError } = await supabaseAdmin.functions.invoke("sync-magazord-mautic", {
        body: { jobId: job.id },
      });

      if (invokeError) {
        throw new Error(`Falha ao invocar a função trabalhadora para o trabalho ${job.id}: ${invokeError.message}`);
      }
    }

    return new Response(JSON.stringify({ success: true, message: "Scheduler executado com sucesso." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Erro no scheduler:', error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
})