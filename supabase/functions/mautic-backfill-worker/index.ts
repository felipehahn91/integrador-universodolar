import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH_SIZE = 10;
const API_DELAY_MS = 500;
const timestamp = () => `[${new Date().toLocaleTimeString('pt-BR', { hour12: false })}]`;

// Helper function to get Mautic OAuth2 token
const getMauticToken = async (mauticUrl: string, clientId: string, clientSecret: string) => {
  const tokenUrl = `${mauticUrl}/oauth/v2/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Falha ao obter token do Mautic: ${response.status} ${errorBody}`);
  }
  const data = await response.json();
  return data.access_token;
};

// Mautic tag mapping logic
const getMauticTagForStatus = (status: string): string | null => {
  const s = status.toLowerCase();
  if (s.includes('aguardando pagamento') || s.includes('análise de pagamento')) return 'pedido-aguardando-pagamento';
  if (s.includes('aprovado') || s.includes('nota fiscal emitida') || s.includes('em transporte')) return 'pedido-em-processamento';
  if (s.includes('entregue')) return 'pedido-entregue';
  if (s.includes('cancelado')) return 'pedido-cancelado';
  return null;
};

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

    const mauticUrl = Deno.env.get('MAUTIC_URL');
    const mauticClientId = Deno.env.get('MAUTIC_CLIENT_ID');
    const mauticClientSecret = Deno.env.get('MAUTIC_CLIENT_SECRET');
    if (!mauticUrl || !mauticClientId || !mauticClientSecret) {
      throw new Error("Credenciais do Mautic (URL, CLIENT_ID, CLIENT_SECRET) não configuradas.");
    }

    const accessToken = await getMauticToken(mauticUrl, mauticClientId, mauticClientSecret);
    const mauticHeaders = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

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
    } else {
      logs.push(`${timestamp()} ${contacts.length} contatos encontrados. Sincronizando com Mautic...`);
      let processedInBatch = 0;

      for (const contact of contacts) {
        if (!contact.email) {
          logs.push(`${timestamp()}  - Aviso: Contato ${contact.magazord_id} pulado por não ter email.`);
          continue;
        }

        const { data: latestOrder } = await supabaseAdmin.from('magazord_orders').select('status').eq('contact_id', contact.id).order('data_pedido', { ascending: false }).limit(1).single();
        
        try {
          const newTag = latestOrder ? getMauticTagForStatus(latestOrder.status) : null;

          const searchUrl = `${mauticUrl}/api/contacts?search=idmagazord:${contact.magazord_id}`;
          const searchResponse = await fetch(searchUrl, { headers: mauticHeaders });
          const searchResult = await searchResponse.json();
          
          const nomeCompleto = contact.nome || '';
          const nomeParts = nomeCompleto.split(' ').filter(Boolean);
          const contactPayload: any = {
            firstname: nomeParts[0] || '',
            lastname: nomeParts.slice(1).join(' ') || '',
            email: contact.email,
            idmagazord: String(contact.magazord_id),
            company: "Universo do Lar",
          };

          if (newTag) {
            contactPayload.tags = newTag;
          }

          if (searchResult.total > 0) {
            const mauticContactId = Object.keys(searchResult.contacts)[0];
            const updateUrl = `${mauticUrl}/api/contacts/${mauticContactId}/edit`;
            const updateResponse = await fetch(updateUrl, { method: 'PATCH', headers: mauticHeaders, body: JSON.stringify(contactPayload) });
            if (!updateResponse.ok) throw new Error(`Falha ao ATUALIZAR contato ${mauticContactId}: ${await updateResponse.text()}`);
            logs.push(`${timestamp()}  - Sucesso: ${contact.email} (ID Mautic: ${mauticContactId}) atualizado ${newTag ? `com a tag ${newTag}` : 'sem nova tag'}.`);
          } else {
            const createUrl = `${mauticUrl}/api/contacts/new`;
            const createResponse = await fetch(createUrl, { method: 'POST', headers: mauticHeaders, body: JSON.stringify(contactPayload) });
            if (!createResponse.ok) throw new Error(`Falha ao CRIAR contato: ${await createResponse.text()}`);
            const createResult = await createResponse.json();
            const mauticContactId = createResult.contact.id;
            logs.push(`${timestamp()}  - Sucesso: ${contact.email} (ID Mautic: ${mauticContactId}) criado ${newTag ? `com a tag ${newTag}` : 'sem tag'}.`);
          }
          processedInBatch++;
        } catch (syncError) {
          logs.push(`${timestamp()}  - ERRO ${contact.email}: ${syncError.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
      }
      logs.push(`${timestamp()} Lote ${page} finalizado. ${processedInBatch} contatos processados.`);
    }
    
    await appendLogs(jobId, logs);
    await supabaseAdmin.from('sync_jobs').update({ last_processed_page: page, processed_count: (page * BATCH_SIZE) }).eq('id', jobId);

    if (page < totalPages) {
      await supabaseAdmin.functions.invoke('mautic-backfill-worker', {
        body: { page: page + 1, jobId, totalPages }
      });
    } else {
      await supabaseAdmin.from('sync_jobs').update({ status: 'completed', finished_at: new Date().toISOString() }).eq('id', jobId);
    }

    return new Response(JSON.stringify({ success: true, message: `Lote ${page} processado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const finalLog = `${timestamp()} ERRO FATAL no lote ${page}: ${error.message}`;
    await supabaseAdmin.from('sync_jobs').update({ status: 'failed', finished_at: new Date().toISOString() }).eq('id', jobId);
    await appendLogs(jobId, [finalLog]);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})