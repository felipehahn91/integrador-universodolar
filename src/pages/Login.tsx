import { supabase } from "@/integrations/supabase/client";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

const Login = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<'sign_in' | 'forgotten_password'>('sign_in');

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        navigate("/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleForgotPassword = () => {
    setView('forgotten_password');
  };

  const handleBackToLogin = () => {
    setView('sign_in');
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary/10 via-white to-secondary/10">
      <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-2xl shadow-2xl">
        <img src="/logo.webp" alt="Universo do Lar Logo" className="w-48 mx-auto" />

        {view === 'sign_in' && (
          <>
            <div className="text-center">
              <h1 className="text-2xl font-bold text-gray-900">Bem-vindo de volta!</h1>
              <p className="text-sm text-gray-500">Acesse sua conta para continuar</p>
            </div>
            <Auth
              supabaseClient={supabase}
              appearance={{ theme: ThemeSupa }}
              providers={[]}
              view="sign_in"
              showLinks={false}
              localization={{
                variables: {
                  sign_in: {
                    email_label: 'Seu email',
                    password_label: 'Sua senha',
                    button_label: 'Entrar',
                  },
                },
              }}
            />
            <div className="text-center">
              <button
                onClick={handleForgotPassword}
                className="text-sm text-gray-600 hover:text-primary underline"
              >
                Esqueceu sua senha?
              </button>
            </div>
          </>
        )}

        {view === 'forgotten_password' && (
          <>
            <div className="text-center">
              <h1 className="text-2xl font-bold text-gray-900">Recuperar Senha</h1>
              <p className="text-sm text-gray-500">Insira seu email para receber as instruções</p>
            </div>
            <Auth
              supabaseClient={supabase}
              appearance={{ theme: ThemeSupa }}
              providers={[]}
              view="forgotten_password"
              showLinks={false}
              localization={{
                variables: {
                  forgotten_password: {
                    email_label: 'Seu email',
                    button_label: 'Enviar instruções',
                  },
                },
              }}
            />
            <div className="text-center">
              <button
                onClick={handleBackToLogin}
                className="text-sm text-gray-600 hover:text-primary underline"
              >
                Voltar para o login
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Login;