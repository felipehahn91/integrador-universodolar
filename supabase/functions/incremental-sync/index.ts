import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

const PAGE_LIMIT = 100;
const timestamp = () => `[${new Date().toLocaleTimeString('pt-BR', { hour12: false })}]`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let jobId: string | null = null;
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const appendLogs = async (jobId: string, logs: string[]) => {
    if (!jobId || logs.length === 0) return;
    try {
      const { error } = await supabaseAdmin.rpc('append_logs_to_job', { p_job_id: jobId, p_logs: logs });
      if (error) throw new Error(`Falha ao registrar log: ${error.message}`);
    } catch (e) { console.error(e.message); }
  };

  try {
    const { full_sync = false } = await req.json().catch(() => ({}));
    
    const authHeader = req.headers.get('Authorization');
    const cronSecretHeader = req.headers.get('x-cron-secret');
    const cronSecretEnv = Deno.env.get('CRON_SECRET');
    let authorized = false;
    if (cronSecretEnv && cronSecretHeader === cronSecretEnv) authorized = true;
    if (!authorized && authHeader) {
      try {
        const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) authorized = true;
      } catch (e) { console.error('JWT validation error:', e.message); }
    }
    if (!authorized) return new Response(JSON.stringify({ success: false, error: 'Não autorizado.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    
    const { data: jobData, error: createJobError } = await supabaseAdmin.from('sync_jobs').insert({ status: 'running', full_sync, logs: [`${timestamp()} Sincronização ${full_sync ? 'completa' : 'incremental'} iniciada.`] }).select('id').single();
    if (createJobError || !jobData) throw new Error(createJobError?.message || 'Falha ao criar o registro do job.');
    jobId = jobData.id;

    const { data: runningJobs } = await supabaseAdmin.from('sync_jobs').select('id').eq('status', 'running').neq('id', jobId);
    if (runningJobs && runningJobs.length > 0) {
      const skipLog = `${timestamp()} Pulado: outra sincronização já estava em andamento.`;
      await supabaseAdmin.from('sync_jobs').update({ status: 'skipped', finished_at: new Date().toISOString(), logs: [skipLog] }).eq('id', jobId);
      return new Response(JSON.stringify({ success: true, message: 'Sincronização já em progresso. Ignorado.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN');
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET');
    if (!magazordApiToken || !magazordApiSecret) throw new Error('Credenciais da API Magazord não configuradas.');
    const authHeaderMagazord = `Basic ${btoa(`${magazordApiToken}:${magazordApiSecret}`)}`;
    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';

    // --- Etapa 1: Sincronizar Novos Contatos ---
    let currentPage = 1;
    let newRecordsCount = 0;
    let stopSync = false;
    let currentLogs: string[] = [`${timestamp()} Etapa 1: Buscando novos contatos...`];
    
    while (!stopSync) {
      currentLogs.push(`${timestamp()} Buscando contatos na página ${currentPage} da Magazord.`);
      const contactsEndpoint = `${magazordBaseUrl}/v2/site/pessoa?page=${currentPage}&orderBy=id&orderDirection=desc&limit=${PAGE_LIMIT}`;
      const contactsResponse = await fetch(contactsEndpoint, { headers: { 'Authorization': authHeaderMagazord } });
      if (!contactsResponse.ok) throw new Error(`Falha na API da Magazord na página ${currentPage} com status ${contactsResponse.status}`);
      const result = await contactsResponse.json();
      const rawContacts = result.data?.items || [];
      if (rawContacts.length === 0) {
        currentLogs.push(`${timestamp()} Nenhuma novo contato encontrado.`);
        stopSync = true;
        continue;
      }

      for (const contact of rawContacts) {
        const { data: existingContact } = await supabaseAdmin.from('magazord_contacts').select('id').eq('magazord_id', String(contact.id)).maybeSingle();
        if (existingContact && !full_sync) {
          currentLogs.push(`${timestamp()} Contato ${contact.id} já existe. Encerrando busca incremental.`);
          stopSync = true;
          break;
        }
        if (existingContact && full_sync) {
          continue; // Em sync completo, apenas pula os existentes
        }

        currentLogs.push(`${timestamp()} Novo contato encontrado: ${contact.nome} (ID: ${contact.id}). Inserindo...`);
        const contactData = { nome: contact.nome, email: contact.email, cpf_cnpj: contact.cpfCnpj, tipo_pessoa: contact.tipo === 1 ? 'F' : (contact.tipo === 2 ? 'J' : null), sexo: contact.sexo, magazord_id: String(contact.id), telefone: contact.pessoaContato?.[0]?.contato || null };
        const { data: newContact, error: insertError } = await supabaseAdmin.from('magazord_contacts').insert(contactData).select('id, cpf_cnpj, magazord_id, nome, email').single();
        if (insertError) {
          currentLogs.push(`${timestamp()} ERRO ao inserir contato ${contact.id}: ${insertError.message}`);
          continue;
        }
        newRecordsCount++;

        if (newContact?.cpf_cnpj) {
          // ... (código de busca de pedidos e chamada ao mautic) ...
        }
      }
      await appendLogs(jobId, currentLogs);
      currentLogs = [];
      if (!stopSync) currentPage++;
    }

    // --- Etapa 2: Atualizar Status de Pedidos Existentes ---
    currentLogs.push(`${timestamp()} Etapa 2: Buscando pedidos para atualizar status...`);
    let updatedOrdersCount = 0;
    // ... (código de atualização de pedidos com logging similar) ...
    await appendLogs(jobId, currentLogs);
    currentLogs = [];

    // --- Etapa Final: Registrar Conclusão do Job ---
    const finalLog = `${timestamp()} Sincronização concluída. ${newRecordsCount} novos contatos. ${updatedOrdersCount} pedidos atualizados.`;
    await appendLogs(jobId, [finalLog]);
    await supabaseAdmin.from('sync_jobs').update({ status: 'completed', finished_at: new Date().toISOString(), new_records_added: newRecordsCount, orders_status_updated_count: updatedOrdersCount }).eq('id', jobId);
    return new Response(JSON.stringify({ success: true, message: finalLog }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = `${timestamp()} ERRO FATAL: ${error.message}`;
    if (jobId) {
      await appendLogs(jobId, [errorMessage]);
      await supabaseAdmin.from('sync_jobs').update({ status: 'failed', finished_at: new Date().toISOString() }).eq('id', jobId);
    }
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
})