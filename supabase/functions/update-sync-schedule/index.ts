import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { intervalHours } = await req.json();

    if (!intervalHours || typeof intervalHours !== 'number' || intervalHours <= 0) {
      throw new Error('O intervalo em horas deve ser um número positivo.');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const jobName = 'regular-sync';
    const cronPattern = `0 */${intervalHours} * * *`;

    try {
      await supabaseAdmin.rpc('cron.unschedule', { job_name: jobName });
    } catch (e) {
      if (!e.message.includes('job not found')) throw e;
    }

    const command = `
      SELECT net.http_post(
          url:='${Deno.env.get('SUPABASE_URL')}/functions/v1/incremental-sync',
          headers:='{"Content-Type": "application/json", "apikey": "${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}"}'
      )
    `;

    const { error: scheduleError } = await supabaseAdmin.rpc('cron.schedule', {
      job_name: jobName,
      schedule: cronPattern,
      command: command
    });

    if (scheduleError) throw scheduleError;

    return new Response(
      JSON.stringify({ success: true, message: `Sincronização agendada para cada ${intervalHours} hora(s).` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Erro ao agendar a tarefa:', error);
    return new Response(
      JSON.stringify({ success: false, error: { message: error.message } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})