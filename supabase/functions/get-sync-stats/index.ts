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
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Buscar total de contatos importados
    const { count: totalImported, error: countError } = await supabaseAdmin
      .from('magazord_contacts')
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;

    // 2. Buscar total de contatos disponíveis na Magazord
    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    if (!magazordApiToken || !magazordApiSecret) {
      throw new Error('As credenciais da API Magazord não foram configuradas.');
    }
    const authString = `${magazordApiToken}:${magazordApiSecret}`;
    const authHeader = `Basic ${btoa(authString)}`;
    const contactsEndpoint = 'https://expresso10.painel.magazord.com.br/api/v2/site/pessoa';
    
    const contactsResponse = await fetch(contactsEndpoint, {
      headers: { 'Authorization': authHeader },
    });

    if (!contactsResponse.ok) {
      throw new Error(`Erro na API Magazord: Status ${contactsResponse.status}`);
    }
    const contactsResult = await contactsResponse.json();
    const totalAvailable = contactsResult.data?.total || 0;

    return new Response(
      JSON.stringify({ success: true, data: { totalImported, totalAvailable } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: { message: error.message } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})