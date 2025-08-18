import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { showLoading, showSuccess, showError, dismissToast } from "@/utils/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const PAGE_SIZE = 15;

const fetchContacts = async (page: number) => {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error, count } = await supabase
    .from("magazord_contacts")
    .select("*", { count: 'exact' })
    .order("created_at", { ascending: false })
    .range(from, to);
    
  if (error) throw new Error(error.message);
  return { contacts: data, count };
};

const fetchSyncStats = async () => {
  const { data, error } = await supabase.functions.invoke("get-sync-stats");
  if (error) throw error;
  if (!data.success) throw new Error(data.error.message);
  return data.data;
};

const Dashboard = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isSyncing, setIsSyncing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [syncAmount, setSyncAmount] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

  const { data, isLoading: isLoadingContacts, isError: isContactsError } = useQuery({
    queryKey: ["magazord_contacts", currentPage],
    queryFn: () => fetchContacts(currentPage),
    keepPreviousData: true,
  });
  
  const contacts = data?.contacts;
  const totalContacts = data?.count ?? 0;
  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);

  const { data: stats, isLoading: isLoadingStats } = useQuery({
    queryKey: ["sync_stats"],
    queryFn: fetchSyncStats,
  });

  const handleSync = async (limit: number | null) => {
    setIsSyncing(true);
    setLogs([`[${new Date().toLocaleTimeString()}] Iniciando sincronização...`]);
    const toastId = showLoading("Iniciando sincronização...");

    try {
      const { data, error } = await supabase.functions.invoke("sync-magazord-mautic", {
        body: { limit },
      });
      dismissToast(toastId);

      if (error) throw error;
      if (data?.logs) setLogs(data.logs);
      if (!data.success) throw new Error(data.error.message || "Ocorreu um erro na função.");
      
      showSuccess(data.data.message || "Sincronização concluída com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["magazord_contacts"] });
      queryClient.invalidateQueries({ queryKey: ["sync_stats"] });
    } catch (err: any) {
      dismissToast(toastId);
      const errorMessage = err.message || "Falha ao iniciar a sincronização.";
      showError(errorMessage);
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Erro: ${errorMessage}`]);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status da Sincronização</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-around text-center">
            <div>
              <p className="text-2xl font-bold">
                {isLoadingStats ? <Skeleton className="h-8 w-16" /> : stats?.totalImported ?? 0}
              </p>
              <p className="text-sm text-muted-foreground">Contatos Importados</p>
            </div>
            <div>
              <p className="text-2xl font-bold">
                {isLoadingStats ? <Skeleton className="h-8 w-16" /> : stats?.totalAvailable ?? 0}
              </p>
              <p className="text-sm text-muted-foreground">Total Disponível</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sincronização Manual</CardTitle>
            <CardDescription>Escolha quantos contatos deseja sincronizar.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-end gap-4">
            <div className="flex-1">
              <Label htmlFor="syncAmount">Quantidade</Label>
              <Input
                id="syncAmount"
                type="number"
                value={syncAmount}
                onChange={(e) => setSyncAmount(Number(e.target.value))}
              />
            </div>
            <Button onClick={() => handleSync(syncAmount)} disabled={isSyncing}>
              {isSyncing ? "..." : "Sincronizar"}
            </Button>
            <Button onClick={() => handleSync(null)} disabled={isSyncing} variant="secondary">
              {isSyncing ? "..." : "Sincronizar Tudo"}
            </Button>
          </CardContent>
        </Card>
      </div>

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
          <CardDescription>Lista dos últimos contatos sincronizados. Clique para ver detalhes.</CardDescription>
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
              ) : isContactsError ? (
                <TableRow><TableCell colSpan={4} className="text-center text-red-500">Erro ao carregar contatos.</TableCell></TableRow>
              ) : (
                contacts?.map((contact) => (
                  <TableRow 
                    key={contact.id} 
                    onClick={() => navigate(`/contact/${contact.id}`)}
                    className="cursor-pointer hover:bg-muted/50"
                  >
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
          {totalPages > 1 && (
            <Pagination className="mt-4">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setCurrentPage((prev) => Math.max(prev - 1, 1));
                    }}
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
                <PaginationItem className="text-sm text-muted-foreground">
                  Página {currentPage} de {totalPages}
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setCurrentPage((prev) => Math.min(prev + 1, totalPages));
                    }}
                    className={currentPage === totalPages ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;