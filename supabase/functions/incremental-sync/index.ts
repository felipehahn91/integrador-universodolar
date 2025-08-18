import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PAGE_LIMIT = 100; // Quantidade de contatos por página da API Magazord

const timestamp = () => `[${new Date().toLocaleTimeString()}]`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // 1. Criar um registro do job
  const { data: job, error: createJobError } = await supabaseAdmin
    .from('sync_jobs')
    .insert({ status: 'running', full_sync: false, logs: [`${timestamp()} Sincronização automática iniciada.`] })
    .select('id')
    .single();

  if (createJobError) {
    console.error('Falha ao criar o registro do job:', createJobError);
    return new Response(JSON.stringify({ success: false, error: 'Falha ao iniciar o job.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const jobId = job.id;

  try {
    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    if (!magazordApiToken || !magazordApiSecret) throw new Error('Credenciais da API Magazord não configuradas.');

    const authHeader = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';

    let currentPage = 1;
    let newRecordsCount = 0;
    let stopSync = false;

    while (!stopSync) {
      const endpoint = `${magazordBaseUrl}/v2/site/pessoa?page=${currentPage}&orderBy=id&orderDirection=desc&limit=${PAGE_LIMIT}`;
      const response = await fetch(endpoint, { headers: { 'Authorization': authHeader } });
      if (!response.ok) throw new Error(`Falha na API da Magazord na página ${currentPage} com status ${response.status}`);
      
      const result = await response.json();
      const rawContacts = result.data?.items || [];

      if (rawContacts.length === 0) {
        stopSync = true; // Não há mais contatos para processar
        continue;
      }

      for (const contact of rawContacts) {
        const magazordContactId = String(contact.id);
        
        // Verifica se o contato já existe no nosso banco
        const { data: existingContact, error: checkError } = await supabaseAdmin
          .from('magazord_contacts')
          .select('id')
          .eq('magazord_id', magazordContactId)
          .maybeSingle();

        if (checkError) throw new Error(`Erro ao verificar contato: ${checkError.message}`);

        if (existingContact) {
          // Encontramos um contato que já existe. Paramos a sincronização.
          stopSync = true;
          break; 
        }

        // Se não existe, insere o novo contato
        const contactData = { 
          nome: contact.nome, 
          email: contact.email, 
          cpf_cnpj: contact.cpfCnpj, 
          tipo_pessoa: contact.tipo === 1 ? 'F' : (contact.tipo === 2 ? 'J' : null), 
          sexo: contact.sexo,
          magazord_id: magazordContactId
        };
        const { error: insertError } = await supabaseAdmin.from('magazord_contacts').insert(contactData);
        if (insertError) throw new Error(`Erro ao inserir novo contato: ${insertError.message}`);
        
        newRecordsCount++;
      }
      currentPage++;
    }

    // 3. Finalizar o job com sucesso
    const finalLog = `${timestamp()} Sincronização concluída. ${newRecordsCount} novos contatos adicionados.`;
    await supabaseAdmin
      .from('sync_jobs')
      .update({ 
        status: 'completed', 
        finished_at: new Date().toISOString(), 
        new_records_added: newRecordsCount,
        logs: [finalLog]
      })
      .eq('id', jobId);

    return new Response(JSON.stringify({ success: true, message: finalLog }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    // 4. Registrar falha no job
    const errorMessage = `${timestamp()} ERRO CRÍTICO: ${error.message}`;
    await supabaseAdmin
      .from('sync_jobs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), logs: [errorMessage] })
      .eq('id', jobId);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})