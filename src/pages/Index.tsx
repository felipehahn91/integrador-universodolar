import { useState } from "react";
import { MadeWithDyad } from "@/components/made-with-dyad";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { showLoading, showSuccess, showError, dismissToast } from "@/utils/toast";
import { Link } from "react-router-dom";

const Index = () => {
  const [syncResult, setSyncResult] = useState<any[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const handleSync = async () => {
    setIsLoading(true);
    setSyncResult(null);
    setLogs([]);
    const toastId = showLoading("Iniciando simulação...");
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Iniciando simulação...`]);

    try {
      const { data, error } = await supabase.functions.invoke("sync-magazord-mautic");

      dismissToast(toastId);

      if (error) {
        throw new Error(error.message);
      }
      
      showSuccess(data.message || "Simulação concluída com sucesso!");
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${data.message}`]);
      setSyncResult(data.processedContacts);

    } catch (err: any) {
      dismissToast(toastId);
      const errorMessage = err.message || "Falha ao iniciar a simulação.";
      showError(errorMessage);
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Erro: ${errorMessage}`]);
      console.error("Sync error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="text-center p-8 w-full max-w-5xl">
        <h1 className="text-4xl font-bold mb-4">Painel de Integração</h1>
        <p className="text-xl text-gray-600 mb-8">
          Gerencie a sincronização de contatos entre Magazord e Mautic.
        </p>
        <div className="space-x-4">
          <Button onClick={handleSync} disabled={isLoading}>
            {isLoading ? "Simulando..." : "Iniciar Simulação"}
          </Button>
          <Button asChild variant="secondary">
            <Link to="/settings">Acessar Configurações</Link>
          </Button>
        </div>

        {logs.length > 0 && (
          <Card className="mt-8 text-left">
            <CardHeader>
              <CardTitle>Log da Simulação</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-gray-900 text-white p-4 rounded-md overflow-x-auto text-sm">
                {logs.join("\n")}
              </pre>
            </CardContent>
          </Card>
        )}

        {syncResult && (
          <Card className="mt-8 text-left">
            <CardHeader>
              <CardTitle>Amostra de Dados Processados</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-center">Compras</TableHead>
                    <TableHead className="text-right">Valor Gasto</TableHead>
                    <TableHead>Tags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncResult.map((contact) => (
                    <TableRow key={contact.Codigo}>
                      <TableCell>{contact.Nome}</TableCell>
                      <TableCell>{contact.Email}</TableCell>
                      <TableCell className="text-center">{contact.total_compras}</TableCell>
                      <TableCell className="text-right">
                        {contact.valor_total_gasto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {contact.tags.map((tag: string) => (
                            <Badge key={tag} variant="secondary">{tag}</Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
      <div className="absolute bottom-0 w-full">
        <MadeWithDyad />
      </div>
    </div>
  );
};

export default Index;