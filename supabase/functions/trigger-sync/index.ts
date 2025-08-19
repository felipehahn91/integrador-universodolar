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

    // 1. Generate a secure, random token
    const token = crypto.randomUUID();

    // 2. Store the token in the database
    const { error: tokenError } = await supabaseAdmin
      .from('sync_tokens')
      .insert({ token: token });

    if (tokenError) throw tokenError;

    // 3. Invoke the actual sync function, passing the token for auth
    const { error: invokeError } = await supabaseAdmin.functions.invoke('incremental-sync', {
      body: { token: token }, // CORREÇÃO: O SDK lida com a conversão para JSON automaticamente.
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