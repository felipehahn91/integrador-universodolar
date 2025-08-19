import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

// Status finais que não precisam mais ser verificados.
// Isso otimiza a função para não fazer chamadas desnecessárias à API.
const FINAL_STATUSES = [
    'Cancelado', 
    'Entregue', 
    'Pedido Entregue'
]; 
const BATCH_SIZE = 100; // Quantidade de pedidos a serem processados por execução.

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Verificação de segurança, igual à outra função.
  const cronSecret = Deno.env.get('CRON_SECRET');
  const requestSecret = req.headers.get('x-cron-secret');
  if (!cronSecret || requestSecret !== cronSecret) {
    console.error('Chamada não autorizada para a função update-order-statuses.');
    return new Response(JSON.stringify({ success: false, error: 'Não autorizado.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Busca no banco de dados os pedidos que não estão em um estado final.
    const { data: ordersToUpdate, error: fetchError } = await supabaseAdmin
      .from('magazord_orders')
      .select('id, magazord_order_id, status')
      .not('status', 'in', `(${FINAL_STATUSES.map(s => `'${s}'`).join(',')})`)
      .limit(BATCH_SIZE);

    if (fetchError) {
      throw new Error(`Erro ao buscar pedidos: ${fetchError.message}`);
    }

    if (!ordersToUpdate || ordersToUpdate.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'Nenhum pedido ativo para atualizar.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    if (!magazordApiToken || !magazordApiSecret) throw new Error('Credenciais da API Magazord não configuradas.');
    const authHeader = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';

    let updatedCount = 0;

    for (const order of ordersToUpdate) {
      try {
        const orderEndpoint = `${magazordBaseUrl}/v2/site/pedido/${order.magazord_order_id}`;
        const response = await fetch(orderEndpoint, { headers: { 'Authorization': authHeader } });

        if (!response.ok) {
          console.warn(`Falha ao buscar pedido ${order.magazord_order_id} da Magazord. Status: ${response.status}`);
          continue; // Pula para o próximo pedido
        }

        const result = await response.json();
        const orderDetails = result.data;

        if (!orderDetails) {
            console.warn(`Nenhum dado encontrado para o pedido ${order.magazord_order_id} na Magazord.`);
            continue;
        }

        const newStatus = orderDetails.pedidoSituacaoDescricao;
        const newStatusId = orderDetails.pedidoSituacaoId;

        // Atualiza o banco de dados apenas se o status mudou.
        if (newStatus && newStatus !== order.status) {
          await supabaseAdmin
            .from('magazord_orders')
            .update({
              status: newStatus,
              status_id: newStatusId,
            })
            .eq('id', order.id);
          updatedCount++;
        }
      } catch (apiError) {
        console.error(`Erro ao processar o pedido ${order.magazord_order_id}:`, apiError.message);
      }
    }

    const summaryMessage = `Verificados ${ordersToUpdate.length} pedidos. Status de ${updatedCount} pedidos foram atualizados.`;
    return new Response(JSON.stringify({ success: true, message: summaryMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})