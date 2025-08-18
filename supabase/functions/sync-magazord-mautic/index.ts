import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

// Headers para permitir que o navegador chame esta função
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Resposta padrão para requisições de 'pre-flight' do navegador
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Pega os segredos de forma segura do ambiente do Supabase
    const magazordApiToken = Deno.env.get('MAGAZORD_API_TOKEN')
    const magazordApiSecret = Deno.env.get('MAGAZORD_API_SECRET')

    if (!magazordApiToken || !magazordApiSecret) {
      throw new Error('As credenciais da API Magazord não foram configuradas nos segredos.')
    }

    // Cria um cliente Supabase com permissões de administrador para ler as configurações
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Busca as configurações (intervalo, domínios, etc.) do seu banco de dados
    const { data: settings, error: settingsError } = await supabaseAdmin
      .from('settings')
      .select('*')
      .eq('singleton_key', 1)
      .single()

    if (settingsError) throw settingsError;

    // --- Lógica da API Magazord ---
    const magazordBaseUrl = 'https://expresso10.painel.magazord.com.br/api';
    const contactsEndpoint = `${magazordBaseUrl}/contatos`;

    console.log(`Buscando contatos da Magazord... Batch size: ${settings.batch_size}`);

    const response = await fetch(contactsEndpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'token': magazordApiToken,
        'secret': magazordApiSecret,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Erro na API Magazord: ${response.status} - ${errorBody}`);
    }

    const result = await response.json();
    const contactsData = result.registros; // Ajustado para pegar a propriedade correta

    if (!Array.isArray(contactsData)) {
        throw new Error('A resposta da API Magazord não retornou uma lista de contatos válida.');
    }

    console.log(`Foram encontrados ${contactsData.length} contatos.`);

    // Por enquanto, apenas retornamos uma mensagem de sucesso.
    // Nos próximos passos, vamos processar esses dados e enviá-los para o Mautic.

    return new Response(
      JSON.stringify({ message: `Sincronização iniciada. ${contactsData.length} contatos encontrados na Magazord.` }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Erro na função de sincronização:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})