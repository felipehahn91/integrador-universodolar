import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH_SIZE = 50; // Aumentado o tamanho do lote devido à maior eficiência
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
      logs.push(`${timestamp()} ${contacts.length} contatos encontrados. Sincronizando com Mautic em lote...`);
      
      const validContacts = contacts.filter(c => c.email);
      
      const existingMauticContacts = new Map<string, number>();
      const MAUTIC_SEARCH_CHUNK_SIZE = 10;

      for (let i = 0; i < validContacts.length; i += MAUTIC_SEARCH_CHUNK_SIZE) {
          const chunk = validContacts.slice(i, i + MAUTIC_SEARCH_CHUNK_SIZE);
          const emailsToSearch = chunk.map(c => c.email);

          const searchUrl = `${mauticUrl}/api/contacts?search=${emailsToSearch.map(e => `email:${encodeURIComponent(e)}`).join(' or ')}&limit=${chunk.length}`;
          const searchResponse = await fetch(searchUrl, { headers: mauticHeaders });
          if (!searchResponse.ok) throw new Error(`Falha ao buscar contatos em lote no Mautic: ${await searchResponse.text()}`);
          const searchResult = await searchResponse.json();
          
          Object.values(searchResult.contacts || {}).forEach((c: any) => {
              existingMauticContacts.set(c.fields.core.email.value, c.id);
          });
      }
      
      const contactsToCreate = [];
      const contactsToUpdate: { [key: string]: any } = {};

      for (const contact of validContacts) {
        const { data: latestOrder } = await supabaseAdmin.from('magazord_orders').select('status').eq('contact_id', contact.id).order('data_pedido', { ascending: false }).limit(1).single();
        const newTag = latestOrder ? getMauticTagForStatus(latestOrder.status) : null;
        const nomeParts = (contact.nome || '').split(' ').filter(Boolean);
        
        const payload = {
          firstname: nomeParts[0] || '',
          lastname: nomeParts.slice(1).join(' ') || '',
          email: contact.email,
          idmagazord: String(contact.magazord_id),
          company: "Universo do Lar",
          tags: newTag ? [newTag] : [],
        };

        const mauticId = existingMauticContacts.get(contact.email);
        if (mauticId) {
          contactsToUpdate[mauticId] = payload;
        } else {
          contactsToCreate.push(payload);
        }
      }

      if (contactsToCreate.length > 0) {
        const createUrl = `${mauticUrl}/api/contacts/batch/new`;
        const createResponse = await fetch(createUrl, { method: 'POST', headers: mauticHeaders, body: JSON.stringify(contactsToCreate) });
        if (!createResponse.ok) throw new Error(`Falha ao criar contatos em lote: ${await createResponse.text()}`);
        logs.push(`${timestamp()}  - Sucesso: ${contactsToCreate.length} contatos criados em lote.`);
      }

      if (Object.keys(contactsToUpdate).length > 0) {
        const updateUrl = `${mauticUrl}/api/contacts/batch/edit`;
        const updateResponse = await fetch(updateUrl, { method: 'PATCH', headers: mauticHeaders, body: JSON.stringify(contactsToUpdate) });
        if (!updateResponse.ok) throw new Error(`Falha ao atualizar contatos em lote: ${await updateResponse.text()}`);
        logs.push(`${timestamp()}  - Sucesso: ${Object.keys(contactsToUpdate).length} contatos atualizados em lote.`);
      }
      
      logs.push(`${timestamp()} Lote ${page} finalizado.`);
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