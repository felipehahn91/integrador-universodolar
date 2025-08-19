import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from "https://deno.land/std@0.150.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (_req) => {
  if (_req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const token = crypto.randomUUID();

    const { error: tokenError } = await supabaseAdmin
      .from('sync_tokens')
      .insert({ token: token });

    if (tokenError) throw tokenError;

    // Invocando a função com o token no cabeçalho para maior robustez
    const { error: invokeError } = await supabaseAdmin.functions.invoke('incremental-sync', {
      headers: { 'X-Sync-Token': token },
    });

    if (invokeError) throw invokeError;

    return new Response(
      JSON.stringify({ success: true, message: 'Sync triggered successfully.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
})