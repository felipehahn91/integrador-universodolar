import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { showSuccess, showError } from "@/utils/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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

const fetchJobStatus = async (jobId: string) => {
  const { data, error } = await supabase
    .from('sync_jobs')
    .select('*')
    .eq('id', jobId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

const Dashboard = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [syncAmount, setSyncAmount] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { data: contactsData, isLoading: isLoadingContacts } = useQuery({
    queryKey: ["magazord_contacts", currentPage],
    queryFn: () => fetchContacts(currentPage),
    keepPreviousData: true,
  });
  
  const contacts = contactsData?.contacts;
  const totalContacts = contactsData?.count ?? 0;
  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);

  const { data: stats, isLoading: isLoadingStats } = useQuery({
    queryKey: ["sync_stats"],
    queryFn: fetchSyncStats,
  });

  const { data: jobStatus } = useQuery({
    queryKey: ['job_status', activeJobId],
    queryFn: () => fetchJobStatus(activeJobId!),
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'running' || status === 'pending' ? 2000 : false;
    },
    onSuccess: (data) => {
      if (data.status === 'completed' || data.status === 'failed') {
        setActiveJobId(null);
        queryClient.invalidateQueries({ queryKey: ["magazord_contacts"] });
        queryClient.invalidateQueries({ queryKey: ["sync_stats"] });
        if (data.status === 'completed') {
          showSuccess("Sincronização concluída com sucesso!");
        } else {
          showError("A sincronização falhou. Verifique os logs.");
        }
      }
    }
  });

  const handleSync = async (limit: number | null) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      showError("Você precisa estar logado para iniciar uma sincronização.");
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("sync-magazord-mautic", {
        body: { limit, user_id: user.id },
      });

      if (error) throw error;
      if (data.jobId) {
        setActiveJobId(data.jobId);
      } else {
        throw new Error("A função não retornou um ID de trabalho.");
      }
    } catch (err: any) {
      showError(err.message || "Falha ao iniciar a sincronização.");
    }
  };
  
  const isSyncing = !!activeJobId;
  const logs = jobStatus?.logs || [];
  const progress = jobStatus && jobStatus.total_count > 0 
    ? (jobStatus.processed_count / jobStatus.total_count) * 100 
    : 0;

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
                disabled={isSyncing}
              />
            </div>
            <Button onClick={() => handleSync(syncAmount)} disabled={isSyncing}>
              {isSyncing ? "Sincronizando..." : "Sincronizar"}
            </Button>
            <Button onClick={() => handleSync(null)} disabled={isSyncing} variant="secondary">
              {isSyncing ? "Sincronizando..." : "Sincronizar Tudo"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {isSyncing && jobStatus && (
        <Card>
          <CardHeader>
            <CardTitle>Progresso da Sincronização</CardTitle>
            <CardDescription>
              Status: {jobStatus.status} ({jobStatus.processed_count} / {jobStatus.total_count})
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progress} className="mb-4" />
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
                    onClick={(e) => { e.preventDefault(); setCurrentPage((p) => Math.max(p - 1, 1)); }}
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
                <PaginationItem className="text-sm text-muted-foreground">
                  Página {currentPage} de {totalPages}
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => { e.preventDefault(); setCurrentPage((p) => Math.min(p + 1, totalPages)); }}
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