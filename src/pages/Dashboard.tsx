import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { showLoading, showSuccess, showError, dismissToast } from "@/utils/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

const fetchContacts = async () => {
  const { data, error } = await supabase
    .from("magazord_contacts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data;
};

const Dashboard = () => {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const { data: contacts, isLoading: isLoadingContacts, isError } = useQuery({
    queryKey: ["magazord_contacts"],
    queryFn: fetchContacts,
  });

  const handleSync = async () => {
    setIsSyncing(true);
    setLogs([`[${new Date().toLocaleTimeString()}] Iniciando simulação...`]);
    const toastId = showLoading("Iniciando simulação...");

    try {
      const { data, error } = await supabase.functions.invoke("sync-magazord-mautic");
      dismissToast(toastId);

      if (error) throw error;
      if (data?.logs) setLogs(data.logs);
      if (!data.success) throw new Error(data.error.message || "Ocorreu um erro na função.");
      
      showSuccess(data.data.message || "Simulação concluída com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["magazord_contacts"] });
    } catch (err: any) {
      dismissToast(toastId);
      const errorMessage = err.message || "Falha ao iniciar a simulação.";
      showError(errorMessage);
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Erro: ${errorMessage}`]);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sincronização Manual</CardTitle>
          <CardDescription>Inicie a sincronização de contatos entre Magazord e Mautic.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleSync} disabled={isSyncing}>
            {isSyncing ? "Sincronizando..." : "Iniciar Sincronização"}
          </Button>
        </CardContent>
      </Card>

      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Log da Sincronização</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-gray-900 text-white p-4 rounded-md overflow-auto text-sm h-64">
              {logs.join("\n")}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Contatos Sincronizados</CardTitle>
          <CardDescription>Lista dos últimos contatos sincronizados.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Total Gasto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingContacts ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-52" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow><TableCell colSpan={4} className="text-center text-red-500">Erro ao carregar contatos.</TableCell></TableRow>
              ) : (
                contacts?.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>{contact.nome}</TableCell>
                    <TableCell>{contact.email}</TableCell>
                    <TableCell>
                      <Badge variant={contact.tipo_pessoa === 'F' ? 'outline' : 'secondary'}>
                        {contact.tipo_pessoa === 'F' ? 'P. Física' : 'P. Jurídica'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(contact.valor_total_gasto).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;