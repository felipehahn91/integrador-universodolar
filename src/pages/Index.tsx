import { MadeWithDyad } from "@/components/made-with-dyad";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { showLoading, showSuccess, showError, dismissToast } from "@/utils/toast";
import { Link } from "react-router-dom";

const Index = () => {

  const handleSync = async () => {
    const toastId = showLoading("Iniciando sincronização...");
    try {
      // O nome da função é o nome da pasta que criamos
      const { data, error } = await supabase.functions.invoke("sync-magazord-mautic");

      dismissToast(toastId);

      if (error) {
        // Se a função retornar um erro, nós o exibimos
        throw new Error(error.message);
      }
      
      // Exibe a mensagem de sucesso retornada pela função
      showSuccess(data.message || "Sincronização concluída com sucesso!");

    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message || "Falha ao iniciar a sincronização.");
      console.error("Sync error:", err);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <div className="text-center p-8">
        <h1 className="text-4xl font-bold mb-4">Painel de Integração</h1>
        <p className="text-xl text-gray-600 mb-8">
          Gerencie a sincronização de contatos entre Magazord e Mautic.
        </p>
        <div className="space-x-4">
          <Button onClick={handleSync}>Iniciar Sincronização Manual</Button>
          <Button asChild variant="secondary">
            <Link to="/settings">Acessar Configurações</Link>
          </Button>
        </div>
      </div>
      <div className="absolute bottom-0 w-full">
        <MadeWithDyad />
      </div>
    </div>
  );
};

export default Index;