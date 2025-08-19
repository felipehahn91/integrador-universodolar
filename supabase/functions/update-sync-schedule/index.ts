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

    // 1. Unschedule the existing job. It's okay if it doesn't exist.
    const { error: unscheduleError } = await supabaseAdmin.rpc('cron.unschedule', { job_name: jobName });
    if (unscheduleError && !unscheduleError.message.includes('job not found')) {
      // If there's an error, and it's not the expected "job not found", then it's a real problem.
      throw unscheduleError;
    }

    // 2. Construct the headers JSON. The service_role_key is passed as a Bearer token.
    const headersJsonString = JSON.stringify({
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`
    });

    // Use a unique dollar-quoting tag to safely pass the JSON string to SQL.
    const uniqueTag = `$HEADERS$`;

    // 3. Construct the full SQL command to be executed by the cron job.
    const command = `
      SELECT net.http_post(
          url:='${supabaseUrl}/functions/v1/incremental-sync',
          body:='{}'::jsonb, -- http_post requires a body, so we send an empty one.
          headers:=${uniqueTag}${headersJsonString}${uniqueTag}::jsonb
      )
    `;

    // 4. Schedule the new job with the updated command and interval.
    const { error: scheduleError } = await supabaseAdmin.rpc('cron.schedule', {
      job_name: jobName,
      schedule: cronPattern,
      command: command
    });

    if (scheduleError) {
      // If scheduling fails, throw the error to be caught below.
      throw scheduleError;
    }

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