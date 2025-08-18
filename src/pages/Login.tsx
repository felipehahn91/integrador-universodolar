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
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-lg shadow-md">
        {view === 'sign_in' && (
          <>
            <h1 className="text-2xl font-bold text-center">Bem-vindo</h1>
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
                className="text-sm text-gray-600 hover:text-black underline"
              >
                Esqueceu sua senha?
              </button>
            </div>
          </>
        )}

        {view === 'forgotten_password' && (
          <>
            <h1 className="text-2xl font-bold text-center">Recuperar Senha</h1>
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
                className="text-sm text-gray-600 hover:text-black underline"
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