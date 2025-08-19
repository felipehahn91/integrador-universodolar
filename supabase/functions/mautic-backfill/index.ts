import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH_SIZE = 25;
const timestamp = () => `[${new Date().toLocaleTimeString('pt-BR', { hour12: false })}]`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const appendLogs = async (jobId: string, logs: string[]) => {
    if (!jobId || logs.length === 0) return;
    await supabaseAdmin.rpc('append_logs_to_job', { p_job_id: jobId, p_logs: logs });
  };

  try {
    const { page, jobId } = await req.json();
    if (!page || typeof page !== 'number' || page < 1) {
      throw new Error('Número da página inválido.');
    }

    const from = (page - 1) * BATCH_SIZE;
    const to = from + BATCH_SIZE - 1;
    let logs: string[] = [`${timestamp()} Processando lote ${page}. Buscando contatos de ${from} a ${to}...`];

    const { data: contacts, error: contactsError } = await supabaseAdmin
      .from('magazord_contacts')
      .select('id, magazord_id, nome, email')
      .order('created_at', { ascending: true })
      .range(from, to);

    if (contactsError) throw contactsError;
    if (!contacts || contacts.length === 0) {
      logs.push(`${timestamp()} Nenhum contato encontrado neste lote.`);
      await appendLogs(jobId, logs);
      return new Response(JSON.stringify({ success: true, message: 'Nenhum contato para processar nesta página.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    logs.push(`${timestamp()} ${contacts.length} contatos encontrados. Sincronizando com Mautic...`);
    let processedCount = 0;
    for (const contact of contacts) {
      const { data: latestOrder, error: orderError } = await supabaseAdmin.from('magazord_orders').select('status').eq('contact_id', contact.id).order('data_pedido', { ascending: false }).limit(1).single();
      if (orderError) {
        logs.push(`${timestamp()}  - Aviso: Nenhum pedido encontrado para ${contact.email}. Pulando.`);
        continue;
      }

      if (latestOrder) {
        const { data: mauticData, error: mauticError } = await supabaseAdmin.functions.invoke('mautic-sync', { body: { contact: contact, orderStatus: latestOrder.status } });
        if (mauticError) {
          // Alteração aqui: Capturando o erro completo para diagnóstico
          logs.push(`${timestamp()}  - ERRO ao sincronizar ${contact.email}: ${JSON.stringify(mauticError)}`);
        } else {
          logs.push(`${timestamp()}  - Sucesso: ${contact.email} - ${mauticData.message}`);
        }
        processedCount++;
      }
    }
    
    logs.push(`${timestamp()} Lote ${page} finalizado. ${processedCount} contatos processados.`);
    await appendLogs(jobId, logs);

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