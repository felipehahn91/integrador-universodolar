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

    // Busca um lote de contatos que ainda não tiveram seus pedidos sincronizados
    const { data: contacts, error: contactsError } = await supabaseAdmin
      .from('magazord_contacts')
      .select('id, cpf_cnpj')
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

    let processedCount = 0;
    for (const contact of contacts) {
      if (!contact.cpf_cnpj) continue;

      try {
        const ordersEndpoint = `${magazordBaseUrl}/v2/site/pedido?cpfCnpj=${contact.cpf_cnpj}`;
        const ordersResponse = await fetch(ordersEndpoint, { headers: { 'Authorization': authHeader } });

        if (ordersResponse.ok) {
          const ordersResult = await ordersResponse.json();
          const orders = ordersResult.data?.items || [];

          if (orders.length > 0) {
            // Remove pedidos antigos para evitar duplicatas
            await supabaseAdmin.from('magazord_orders').delete().eq('contact_id', contact.id);

            const ordersToInsert = orders.map((order: any) => ({
              contact_id: contact.id,
              magazord_order_id: String(order.id),
              valor_total: order.valorTotal,
              status: order.pedidoSituacaoDescricao,
              status_id: order.pedidoSituacaoId,
              data_pedido: order.dataHora,
            }));
            await supabaseAdmin.from('magazord_orders').insert(ordersToInsert);

            const totalCompras = orders.length;
            const valorTotalGasto = orders.reduce((sum: number, order: any) => sum + parseFloat(order.valorTotal), 0);
            await supabaseAdmin
              .from('magazord_contacts')
              .update({ total_compras: totalCompras, valor_total_gasto: valorTotalGasto })
              .eq('id', contact.id);
          }
        }
      } catch (orderError) {
        console.error(`Falha ao buscar pedidos para o contato ${contact.id}:`, orderError.message);
      }
      processedCount++;
    }

    return new Response(
      JSON.stringify({ success: true, message: `Lote ${page} processado. ${processedCount} contatos verificados.` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
})