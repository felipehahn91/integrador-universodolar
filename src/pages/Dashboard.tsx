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

const fetchLastIncompleteJob = async () => {
  const { data, error } = await supabase
    .from('sync_jobs')
    .select('id, status, updated_at')
    .in('status', ['running', 'failed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
    console.error("Error fetching last incomplete job:", error);
  }
  return data;
}

const Dashboard = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [syncAmount, setSyncAmount] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useQuery({
    queryKey: ['last_incomplete_job'],
    queryFn: fetchLastIncompleteJob,
    onSuccess: async (data) => {
      if (data && !activeJobId) {
        // Detect stale 'running' jobs
        if (data.status === 'running' && data.updated_at) {
          const lastUpdated = new Date(data.updated_at).getTime();
          const now = new Date().getTime();
          const fiveMinutes = 5 * 60 * 1000;
          if (now - lastUpdated > fiveMinutes) {
            // Job is stale, mark it as failed so the user can continue
            await supabase
              .from('sync_jobs')
              .update({ status: 'failed' })
              .eq('id', data.id);
            // Invalidate to refetch and show the 'Continue' button
            queryClient.invalidateQueries({ queryKey: ['last_incomplete_job'] });
            return;
          }
        }
        setActiveJobId(data.id);
      }
    }
  });

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
      if (data.status === 'completed') {
        setActiveJobId(null);
        queryClient.invalidateQueries({ queryKey: ["magazord_contacts"] });
        queryClient.invalidateQueries({ queryKey: ["sync_stats"] });
        queryClient.invalidateQueries({ queryKey: ['last_incomplete_job'] });
        showSuccess("Sincronização concluída com sucesso!");
      } else if (data.status === 'failed') {
        queryClient.invalidateQueries({ queryKey: ['last_incomplete_job'] });
        showError("A sincronização foi interrompida. Você pode continuá-la.");
      }
    }
  });

  const handleSync = async (limit: number | null) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      showError("Você precisa estar logado para iniciar uma sincronização.");
      return;
    }

    let jobIdToUse = activeJobId;

    if (jobStatus && jobStatus.status !== 'failed') {
      showError("Uma sincronização já está em andamento.");
      return;
    }

    if (!jobIdToUse || (jobStatus && jobStatus.status !== 'failed')) {
      const { data: newJob, error: createJobError } = await supabase
        .from('sync_jobs')
        .insert({ user_id: user.id, status: 'pending' })
        .select('id')
        .single();

      if (createJobError || !newJob) {
        showError("Não foi possível iniciar o trabalho de sincronização.");
        return;
      }
      jobIdToUse = newJob.id;
      setActiveJobId(jobIdToUse);
    }
    
    supabase.functions.invoke("sync-magazord-mautic", {
      body: { limit, jobId: jobIdToUse },
    }).then(async ({ error }) => {
      if (error) {
        console.error("Function invocation failed:", error);
        const timestamp = `[${new Date().toLocaleTimeString()}]`;
        const logMessage = `${timestamp} ERRO CRÍTICO: A chamada para a função de sincronização falhou. Isso pode ser um timeout ou um problema de rede. Tente continuar a sincronização.`;
        
        await supabase
          .from('sync_jobs')
          .update({ 
            status: 'failed', 
            logs: [logMessage],
            finished_at: new Date().toISOString()
          })
          .eq('id', jobIdToUse);

        queryClient.invalidateQueries({ queryKey: ['job_status', jobIdToUse] });
        queryClient.invalidateQueries({ queryKey: ['last_incomplete_job'] });
      }
    });
  };
  
  const isSyncing = jobStatus?.status === 'running' || jobStatus?.status === 'pending';
  const hasFailedJob = jobStatus?.status === 'failed';
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
            <CardDescription>
              {hasFailedJob ? "Uma sincronização foi interrompida. Continue de onde parou." : "Escolha quantos contatos deseja sincronizar."}
            </CardDescription>
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
              {isSyncing ? "Sincronizando..." : (hasFailedJob ? "Continuar" : "Sincronizar")}
            </Button>
            <Button onClick={() => handleSync(null)} disabled={isSyncing} variant="secondary">
              {isSyncing ? "Sincronizando..." : (hasFailedJob ? "Continuar Tudo" : "Sincronizar Tudo")}
            </Button>
          </CardContent>
        </Card>
      </div>

      {activeJobId && jobStatus && (
        <Card>
          <CardHeader>
            <CardTitle>Progresso da Sincronização</CardTitle>
            <CardDescription>
              Status: {jobStatus.status} ({jobStatus.processed_count} / {jobStatus.total_count}) - Página: {jobStatus.last_processed_page}
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