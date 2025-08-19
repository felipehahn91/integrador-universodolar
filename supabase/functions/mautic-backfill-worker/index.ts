import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH_SIZE = 25;
const API_DELAY_MS = 500;
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

  const { page, jobId, totalPages } = await req.json();

  try {
    if (!page || !jobId || !totalPages) {
      throw new Error('Parâmetros page, jobId ou totalPages ausentes.');
    }

    const from = (page - 1) * BATCH_SIZE;
    const to = from + BATCH_SIZE - 1;
    let logs: string[] = [`${timestamp()} Processando lote ${page} de ${totalPages}. Buscando contatos de ${from} a ${to}...`];

    const { data: contacts, error: contactsError } = await supabaseAdmin
      .from('magazord_contacts')
      .select('id, magazord_id, nome, email')
      .order('created_at', { ascending: true })
      .range(from, to);

    if (contactsError) throw contactsError;
    if (!contacts || contacts.length === 0) {
      logs.push(`${timestamp()} Nenhum contato encontrado neste lote.`);
      await appendLogs(jobId, logs);
    } else {
      logs.push(`${timestamp()} ${contacts.length} contatos encontrados. Sincronizando com Mautic...`);
      let processedInBatch = 0;
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const mauticSyncUrl = `${supabaseUrl}/functions/v1/mautic-sync`;

      for (const contact of contacts) {
        const { data: latestOrder } = await supabaseAdmin.from('magazord_orders').select('status').eq('contact_id', contact.id).order('data_pedido', { ascending: false }).limit(1).single();
        if (latestOrder) {
          try {
            const response = await fetch(mauticSyncUrl, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ contact: contact, orderStatus: latestOrder.status })
            });
            const responseData = await response.json();
            if (!response.ok) {
              logs.push(`${timestamp()}  - ERRO ${contact.email}: ${responseData.error?.message || JSON.stringify(responseData)}`);
            } else {
              logs.push(`${timestamp()}  - Sucesso: ${contact.email} - ${responseData.message}`);
            }
          } catch (fetchError) {
            logs.push(`${timestamp()}  - ERRO DE REDE ${contact.email}: ${fetchError.message}`);
          }
          processedInBatch++;
        } else {
          logs.push(`${timestamp()}  - Aviso: Nenhum pedido encontrado para ${contact.email}. Pulando.`);
        }
        await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
      }
      logs.push(`${timestamp()} Lote ${page} finalizado. ${processedInBatch} contatos processados.`);
    }
    
    await appendLogs(jobId, logs);
    await supabaseAdmin.from('sync_jobs').update({ last_processed_page: page, processed_count: (page * BATCH_SIZE) }).eq('id', jobId);

    // Se não for a última página, chama a próxima
    if (page < totalPages) {
      await supabaseAdmin.functions.invoke('mautic-backfill-worker', {
        body: { page: page + 1, jobId, totalPages }
      });
    } else {
      // Se for a última página, finaliza o job
      await supabaseAdmin.from('sync_jobs').update({ status: 'completed', finished_at: new Date().toISOString() }).eq('id', jobId);
    }

    return new Response(JSON.stringify({ success: true, message: `Lote ${page} processado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    await supabaseAdmin.from('sync_jobs').update({ status: 'failed', finished_at: new Date().toISOString(), logs: [`${timestamp()} ERRO FATAL no lote ${page}: ${error.message}`] }).eq('id', jobId);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})