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

    const mauticUrl = Deno.env.get('MAUTIC_URL');
    const mauticUsername = Deno.env.get('MAUTIC_USERNAME');
    const mauticPassword = Deno.env.get('MAUTIC_PASSWORD');

    if (!mauticUrl || !mauticUsername || !mauticPassword) {
      throw new Error("As credenciais do Mautic não estão configuradas nos Secrets.");
    }

    const authString = `${mauticUsername}:${mauticPassword}`;
    const authHeader = `Basic ${btoa(authString)}`;
    const headers = { 'Authorization': authHeader, 'Content-Type': 'application/json' };

    // 1. Encontrar ou criar o contato no Mautic
    const searchUrl = `${mauticUrl}/api/contacts?search=magazord_id:${contact.magazord_id}`;
    const searchResponse = await fetch(searchUrl, { headers });
    const searchResult = await searchResponse.json();

    let mauticContactId: number;

    if (searchResult.total > 0) {
      mauticContactId = Object.keys(searchResult.contacts)[0];
    } else {
      const createUrl = `${mauticUrl}/api/contacts/new`;
      const createPayload = {
        firstname: contact.nome?.split(' ')[0] || '',
        lastname: contact.nome?.split(' ').slice(1).join(' ') || '',
        email: contact.email,
        magazord_id: contact.magazord_id,
        overwriteWithBlank: true,
      };
      const createResponse = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(createPayload) });
      const createResult = await createResponse.json();
      if (!createResult.contact?.id) throw new Error("Falha ao criar contato no Mautic.");
      mauticContactId = createResult.contact.id;
    }

    // 2. Gerenciar as tags
    const newTag = getMauticTagForStatus(orderStatus);
    if (!newTag) { // Se o status não mapeia para uma tag, não fazemos nada
      return new Response(JSON.stringify({ success: true, message: `Status '${orderStatus}' ignorado.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Remove todas as tags de status antigas para evitar conflitos
    const tagsToRemove = ALL_STATUS_TAGS.filter(t => t !== newTag);
    const removeUrl = `${mauticUrl}/api/contacts/${mauticContactId}/tags/remove`;
    await fetch(removeUrl, { method: 'POST', headers, body: JSON.stringify({ tags: tagsToRemove }) });

    // Adiciona a nova tag de status
    const addUrl = `${mauticUrl}/api/contacts/${mauticContactId}/tags/add`;
    await fetch(addUrl, { method: 'POST', headers, body: JSON.stringify({ tags: [newTag] }) });

    return new Response(
      JSON.stringify({ success: true, message: `Contato ${mauticContactId} atualizado com a tag ${newTag}.` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})