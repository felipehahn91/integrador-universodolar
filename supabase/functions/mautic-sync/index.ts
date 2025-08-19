import { serve } from "https://deno.land/std@0.190.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Mapeia o status do pedido para a tag correspondente no Mautic
const getMauticTagForStatus = (status: string): string | null => {
  const s = status.toLowerCase();
  if (s.includes('aguardando pagamento') || s.includes('análise de pagamento')) {
    return 'pedido-aguardando-pagamento';
  }
  if (s.includes('aprovado') || s.includes('nota fiscal emitida') || s.includes('em transporte')) {
    return 'pedido-em-processamento';
  }
  if (s.includes('entregue')) {
    return 'pedido-entregue';
  }
  if (s.includes('cancelado')) {
    return 'pedido-cancelado';
  }
  return null;
};

const ALL_STATUS_TAGS = [
  'pedido-aguardando-pagamento',
  'pedido-em-processamento',
  'pedido-entregue',
  'pedido-cancelado'
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { contact, orderStatus } = await req.json();
    if (!contact || !orderStatus) {
      throw new Error("Dados do contato ou status do pedido ausentes.");
    }

    if (!contact.email) {
      return new Response(JSON.stringify({ success: true, message: `Contato ${contact.magazord_id} pulado por não ter email.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const mauticUrl = Deno.env.get('MAUTIC_URL');
    const mauticUsername = Deno.env.get('MAUTIC_USERNAME');
    const mauticPassword = Deno.env.get('MAUTIC_PASSWORD');

    if (!mauticUrl || !mauticUsername || !mauticPassword) {
      throw new Error("As credenciais do Mautic não estão configuradas nos Secrets.");
    }

    const authString = `${mauticUsername}:${mauticPassword}`;
    const authHeader = `Basic ${btoa(authString)}`;
    const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json' };

    const searchUrl = `${mauticUrl}/api/contacts?search=idmagazord:${contact.magazord_id}`;
    const searchResponse = await fetch(searchUrl, { headers });
    const searchResult = await searchResponse.json();

    let mauticContactId: number;

    const nomeCompleto = contact.nome || '';
    const nomeParts = nomeCompleto.split(' ').filter(Boolean);
    const firstname = nomeParts[0] || '';
    const lastname = nomeParts.slice(1).join(' ') || '';

    const contactPayload = {
      firstname: firstname,
      lastname: lastname,
      email: contact.email,
      idmagazord: parseInt(contact.magazord_id, 10),
      companyname: "Universo do Lar",
    };

    if (searchResult.total > 0) {
      mauticContactId = Object.keys(searchResult.contacts)[0];
      const updateUrl = `${mauticUrl}/api/contacts/${mauticContactId}/edit`;
      const updateResponse = await fetch(updateUrl, { method: 'PATCH', headers, body: JSON.stringify(contactPayload) });
      if (!updateResponse.ok) {
        const errorBody = await updateResponse.text();
        throw new Error(`Falha ao ATUALIZAR contato no Mautic (ID: ${mauticContactId}). Status: ${updateResponse.status}. Resposta: ${errorBody}. Payload enviado: ${JSON.stringify(contactPayload)}`);
      }
    } else {
      const createUrl = `${mauticUrl}/api/contacts/new`;
      const createResponse = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(contactPayload) });
      if (!createResponse.ok) {
        const errorBody = await createResponse.text();
        throw new Error(`Falha ao CRIAR contato no Mautic. Status: ${createResponse.status}. Resposta: ${errorBody}. Payload enviado: ${JSON.stringify(contactPayload)}`);
      }
      const createResult = await createResponse.json();
      if (!createResult.contact?.id) throw new Error(`Falha ao criar contato no Mautic (resposta inesperada): ${JSON.stringify(createResult)}`);
      mauticContactId = createResult.contact.id;
    }

    const newTag = getMauticTagForStatus(orderStatus);
    if (!newTag) {
      return new Response(JSON.stringify({ success: true, message: `Status '${orderStatus}' ignorado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const tagsToRemove = ALL_STATUS_TAGS.filter(t => t !== newTag);
    if (tagsToRemove.length > 0) {
      const removeUrl = `${mauticUrl}/api/contacts/${mauticContactId}/tags/remove`;
      const removeResponse = await fetch(removeUrl, { method: 'POST', headers, body: JSON.stringify({ tags: tagsToRemove }) });
      if (!removeResponse.ok) {
        const errorBody = await removeResponse.text();
        throw new Error(`Falha ao REMOVER tags do contato ${mauticContactId}. Status: ${removeResponse.status}. Resposta: ${errorBody}`);
      }
    }

    const addUrl = `${mauticUrl}/api/contacts/${mauticContactId}/tags/add`;
    const addResponse = await fetch(addUrl, { method: 'POST', headers, body: JSON.stringify({ tags: [newTag] }) });
    if (!addResponse.ok) {
      const errorBody = await addResponse.text();
      throw new Error(`Falha ao ADICIONAR tag ao contato ${mauticContactId}. Status: ${addResponse.status}. Resposta: ${errorBody}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: `Contato ${mauticContactId} atualizado com a tag ${newTag}.` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: { message: error.message } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})