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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const jobName = 'regular-sync';
    const cronPattern = `0 */${intervalHours} * * *`;

    // 1. Unschedule existing job
    try {
      // This RPC throws an error if the job is not found, so we catch it.
      const { error: unscheduleError } = await supabaseAdmin.rpc('cron.unschedule', { job_name: jobName });
      // We only want to throw errors that are not "job not found".
      if (unscheduleError && !unscheduleError.message.includes('job not found')) {
        throw unscheduleError;
      }
    } catch (e) {
        // Also catch network or other errors during unschedule
        if (e.message && !e.message.includes('job not found')) {
            throw e;
        }
    }

    // 2. Construct the new command safely
    const headersJsonString = JSON.stringify({
      "Content-Type": "application/json",
      "apikey": serviceKey
    });

    // Use dollar-quoting ($$) to prevent issues with special characters in the headers
    const command = `
      SELECT net.http_post(
          url:='${supabaseUrl}/functions/v1/incremental-sync',
          headers:=${'$$'}${headersJsonString}${'$$'}
      )
    `;

    // 3. Schedule the new job
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