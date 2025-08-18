import { MadeWithDyad } from "@/components/made-with-dyad";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const Index = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <div className="text-center p-8">
        <h1 className="text-4xl font-bold mb-4">Painel de Integração</h1>
        <p className="text-xl text-gray-600 mb-8">
          Gerencie a sincronização de contatos entre Magazord e Mautic.
        </p>
        <div className="space-x-4">
          <Button asChild>
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