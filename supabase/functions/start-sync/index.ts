import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PAGE_LIMIT = 100;
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

    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    if (!magazordApiToken || !magazordApiSecret) throw new Error('Credenciais da API Magazord não configuradas.');
    const authHeaderMagazord = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
    const contactsEndpoint = `https://expresso10.painel.magazord.com.br/api/v2/site/pessoa?limit=1`;
    const contactsResponse = await fetch(contactsEndpoint, { headers: { 'Authorization': authHeaderMagazord } });
    if (!contactsResponse.ok) throw new Error(`Falha ao buscar total de contatos da Magazord: ${contactsResponse.status}`);
    const result = await contactsResponse.json();
    const totalCount = result.data?.total || 0;
    const totalPages = Math.ceil(totalCount / PAGE_LIMIT);

    const initialLog = `${timestamp()} Tarefa manual '${full_sync ? 'Sincronização Completa' : 'Sincronização Incremental'}' iniciada. Total de ${totalCount} contatos em ${totalPages} lotes.`;
    const { data: jobData, error: createError } = await supabaseAdmin
      .from('sync_jobs')
      .insert({ user_id: user.id, status: 'running', full_sync, logs: [initialLog], total_count: totalCount })
      .select('id')
      .single();
    if (createError) throw createError;
    const jobId = jobData.id;

    // Inicia o primeiro trabalhador de forma assíncrona
    supabaseAdmin.functions.invoke('sync-worker', {
      body: { page: 1, jobId, totalPages, full_sync }
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