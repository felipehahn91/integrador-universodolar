import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { Clock, RefreshCw } from "lucide-react";
import { showSuccess, showError, showLoading } from "@/utils/toast";
import { Toaster, toast } from "sonner";


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

const fetchSyncHistory = async () => {
  const { data, error } = await supabase
    .from('sync_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data;
}

const fetchSettings = async () => {
  const { data, error } = await supabase
    .from("settings")
    .select("sync_interval_hours")
    .eq("singleton_key", 1)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [isSyncing, setIsSyncing] = useState(false);
  const queryClient = useQueryClient();

  const { data: contactsData, isLoading: isLoadingContacts } = useQuery({
    queryKey: ["magazord_contacts", currentPage],
    queryFn: () => fetchContacts(currentPage),
    keepPreviousData: true,
  });
  
  const contacts = contactsData?.contacts;
  const totalContacts = contactsData?.count ?? 0;
  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);

  const { data: syncHistory, isLoading: isLoadingHistory } = useQuery({
    queryKey: ["sync_history"],
    queryFn: fetchSyncHistory,
    refetchInterval: 30000,
  });

  const { data: settings, isLoading: isLoadingSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });

  const handleManualSync = async () => {
    setIsSyncing(true);
    const toastId = showLoading("Iniciando sincronização manual...");
    
    const { error } = await supabase.functions.invoke('incremental-sync');
    
    toast.dismiss(toastId);

    if (error) {
      showError(`Falha ao iniciar: ${error.message}`);
    } else {
      showSuccess("Sincronização iniciada. A tabela será atualizada em breve.");
      queryClient.invalidateQueries({ queryKey: ['sync_history'] });
    }
    
    setIsSyncing(false);
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case 'completed': return <Badge variant="default">Concluído</Badge>;
      case 'running': return <Badge variant="secondary">Executando...</Badge>;
      case 'failed': return <Badge variant="destructive">Falhou</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sincronização Automática</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingSettings ? (
              <Skeleton className="h-8 w-3/4" />
            ) : (
              <div className="text-2xl font-bold">
                A cada {settings?.sync_interval_hours} hora(s)
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              A tarefa é executada no início de cada intervalo.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Histórico de Sincronizações</CardTitle>
            <CardDescription>Registros das últimas sincronizações.</CardDescription>
          </div>
          <Button onClick={handleManualSync} disabled={isSyncing} size="sm">
            <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
            Sincronizar Agora
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Início</TableHead>
                <TableHead>Fim</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Novos Contatos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingHistory ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : syncHistory && syncHistory.length > 0 ? (
                syncHistory.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>{format(new Date(job.created_at), "dd/MM/yy HH:mm:ss", { locale: ptBR })}</TableCell>
                    <TableCell>{job.finished_at ? format(new Date(job.finished_at), "dd/MM/yy HH:mm:ss", { locale: ptBR }) : '—'}</TableCell>
                    <TableCell>{formatStatus(job.status)}</TableCell>
                    <TableCell className="text-right font-medium">{job.new_records_added}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center">Nenhuma sincronização registrada.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : "" }
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