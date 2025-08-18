import { useState } from "react";
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

const fetchActiveJob = async () => {
  const { data, error } = await supabase
    .from('sync_jobs')
    .select('*')
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
    console.error("Error fetching active job:", error);
  }
  return data;
}

const Dashboard = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [syncAmount, setSyncAmount] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);

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

  const { data: activeJob, refetch: refetchActiveJob } = useQuery({
    queryKey: ['active_job'],
    queryFn: fetchActiveJob,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Continua atualizando enquanto o job não estiver concluído
      return (status && status !== 'completed') ? 5000 : false;
    },
    onSuccess: (data) => {
      if (data?.status === 'completed') {
        queryClient.invalidateQueries({ queryKey: ["magazord_contacts"] });
        queryClient.invalidateQueries({ queryKey: ["sync_stats"] });
        showSuccess("Sincronização concluída com sucesso!");
        // Apenas refaz a busca do job, que agora retornará nulo, limpando a tela.
        refetchActiveJob();
      }
    }
  });

  const handleManualSync = async (limit: number) => {
    if (activeJob) {
      showError("Uma sincronização já está em andamento. Aguarde a conclusão.");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      showError("Você precisa estar logado para iniciar uma sincronização.");
      return;
    }

    const { data: newJob, error: createJobError } = await supabase
      .from('sync_jobs')
      .insert({ user_id: user.id, status: 'pending', full_sync: false })
      .select('id')
      .single();

    if (createJobError || !newJob) {
      showError("Não foi possível iniciar o trabalho de sincronização.");
      return;
    }
    
    refetchActiveJob(); // Mostra o progresso imediatamente

    const { error } = await supabase.functions.invoke("sync-magazord-mautic", {
      body: { limit, jobId: newJob.id },
    });

    if (error) {
      showError("Falha ao iniciar a sincronização manual.");
      console.error(error);
    }
  };

  const handleFullSync = async () => {
    if (activeJob) {
      showError("Uma sincronização já está em andamento. Aguarde a conclusão.");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      showError("Você precisa estar logado para iniciar uma sincronização.");
      return;
    }

    const { error } = await supabase
      .from('sync_jobs')
      .insert({ user_id: user.id, status: 'pending', full_sync: true, last_processed_page: 0 });

    if (error) {
      showError("Não foi possível agendar a sincronização completa.");
    } else {
      showSuccess("Sincronização completa agendada! O processo começará em breve e continuará automaticamente.");
      refetchActiveJob();
    }
  };
  
  const isSyncing = activeJob && activeJob.status !== 'completed';
  const logs = activeJob?.logs || [];
  const progress = activeJob && activeJob.total_count > 0 
    ? ((activeJob.last_processed_page * 100) / activeJob.total_count) * 100
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
              Sincronize uma quantidade específica ou todos os contatos de forma automática.
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
                disabled={!!isSyncing}
              />
            </div>
            <Button onClick={() => handleManualSync(syncAmount)} disabled={!!isSyncing}>
              Sincronizar
            </Button>
            <Button onClick={handleFullSync} disabled={!!isSyncing} variant="secondary">
              Sincronizar Tudo
            </Button>
          </CardContent>
        </Card>
      </div>

      {isSyncing && activeJob && (
        <Card>
          <CardHeader>
            <CardTitle>Progresso da Sincronização</CardTitle>
            <CardDescription>
              Status: {activeJob.status} - Página: {activeJob.last_processed_page || 0} de ~{Math.ceil((stats?.totalAvailable || 0) / 100)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progress} className="mb-4" />
            <pre className="bg-gray-900 text-white p-4 rounded-md overflow-auto text-sm h-64">
              {logs.slice(-50).join("\n")}
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