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
    const { page } = await req.json();
    if (!page || typeof page !== 'number' || page < 1) {
      throw new Error('Número da página inválido.');
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const from = (page - 1) * BATCH_SIZE;
    const to = from + BATCH_SIZE - 1;

    const { data: contacts, error: contactsError } = await supabaseAdmin
      .from('magazord_contacts')
      .select('id, magazord_id')
      .order('created_at', { ascending: true })
      .range(from, to);

    if (contactsError) throw contactsError;
    if (!contacts || contacts.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'Nenhum contato para processar nesta página.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    if (!magazordApiToken || !magazordApiSecret) throw new Error('Credenciais da API Magazord não configuradas.');
    const authHeader = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';

    for (const contact of contacts) {
      try {
        const contactEndpoint = `${magazordBaseUrl}/v2/site/pessoa/${contact.magazord_id}`;
        const response = await fetch(contactEndpoint, { headers: { 'Authorization': authHeader } });

        if (response.ok) {
          const result = await response.json();
          const contactDetails = result.data;

          const getTelefone = (c: any) => {
            if (c.pessoaContato && Array.isArray(c.pessoaContato) && c.pessoaContato.length > 0) {
              return c.pessoaContato[0].contato;
            }
            return null;
          };

          const telefone = getTelefone(contactDetails);

          if (telefone) {
            await supabaseAdmin
              .from('magazord_contacts')
              .update({ telefone: telefone })
              .eq('id', contact.id);
          }
        }
      } catch (updateError) {
        console.error(`Falha ao atualizar o contato ${contact.id} (Magazord ID: ${contact.magazord_id}):`, updateError.message);
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: `Lote ${page} processado.` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
})