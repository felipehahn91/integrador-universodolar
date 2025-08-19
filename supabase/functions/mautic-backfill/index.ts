import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH_SIZE = 25; // Processar 25 contatos por vez para evitar timeouts

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

    // Busca um lote de contatos
    const { data: contacts, error: contactsError } = await supabaseAdmin
      .from('magazord_contacts')
      .select('id, magazord_id, nome, email')
      .order('created_at', { ascending: true })
      .range(from, to);

    if (contactsError) throw contactsError;
    if (!contacts || contacts.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'Nenhum contato para processar nesta página.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let processedCount = 0;
    for (const contact of contacts) {
      // Para cada contato, busca o pedido mais recente para saber o status atual
      const { data: latestOrder, error: orderError } = await supabaseAdmin
        .from('magazord_orders')
        .select('status')
        .eq('contact_id', contact.id)
        .order('data_pedido', { ascending: false })
        .limit(1)
        .single();

      if (orderError) {
        console.error(`Erro ao buscar pedido para o contato ${contact.id}:`, orderError.message);
        continue; // Pula para o próximo contato se não encontrar pedido
      }

      if (latestOrder) {
        // Invoca a função de sincronização do Mautic com os dados do contato e o status do último pedido
        await supabaseAdmin.functions.invoke('mautic-sync', {
          body: {
            contact: contact,
            orderStatus: latestOrder.status
          }
        });
        processedCount++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: `Lote ${page} processado. ${processedCount} contatos enviados ao Mautic.` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
})