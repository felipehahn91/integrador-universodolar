import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Clock, RefreshCw, Users as UsersIcon } from "lucide-react";
import { showError, showLoading } from "@/utils/toast";
import { toast } from "sonner";

const fetchSyncHistory = async () => {
  const { data, error } = await supabase
    .from('sync_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data;
}

const fetchContactStats = async () => {
    const { count, error } = await supabase
    .from('magazord_contacts')
    .select('*', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    return { count };
}

const Dashboard = () => {
  const [isSyncing, setIsSyncing] = useState(false);
  const queryClient = useQueryClient();

  const { data: syncHistory, isLoading: isLoadingHistory } = useQuery({
    queryKey: ["sync_history"],
    queryFn: fetchSyncHistory,
    refetchInterval: 30000,
  });

  const { data: contactStats, isLoading: isLoadingContactStats } = useQuery({
      queryKey: ["contact_stats"],
      queryFn: fetchContactStats,
  });

  const handleManualSync = async () => {
    setIsSyncing(true);
    const toastId = showLoading("Iniciando sincronização completa...");

    try {
      // Etapa 1: Sincronização incremental de novos contatos
      toast.loading("Etapa 1/2: Buscando novos contatos...", { id: toastId });
      const { error: syncError } = await supabase.functions.invoke('incremental-sync');
      if (syncError) {
        throw new Error(`Falha ao buscar novos contatos: ${syncError.message}`);
      }

      // Etapa 2: Atualização dos status dos pedidos
      toast.loading("Etapa 2/2: Atualizando status dos pedidos...", { id: toastId });
      const { error: updateError } = await supabase.functions.invoke('update-order-statuses');
      if (updateError) {
        throw new Error(`Falha ao atualizar status dos pedidos: ${updateError.message}`);
      }

      // Sucesso
      toast.success("Sincronização completa concluída com sucesso!", { id: toastId });
      queryClient.invalidateQueries({ queryKey: ['sync_history'] });
      queryClient.invalidateQueries({ queryKey: ['contact_stats'] });

    } catch (error: any) {
      showError(error.message);
      toast.dismiss(toastId);
    } finally {
      setIsSyncing(false);
    }
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case 'completed': return <Badge variant="default">Concluído</Badge>;
      case 'running': return <Badge variant="secondary">Executando...</Badge>;
      case 'failed': return <Badge variant="destructive">Falhou</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const lastSync = syncHistory?.[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Contatos</CardTitle>
            <UsersIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoadingContactStats ? (
              <Skeleton className="h-8 w-1/2" />
            ) : (
              <div className="text-2xl font-bold">{contactStats?.count}</div>
            )}
            <p className="text-xs text-muted-foreground">
              Total de contatos importados da Magazord.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Última Sincronização</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
             {isLoadingHistory ? (
              <Skeleton className="h-8 w-3/4" />
            ) : (
              <div className="text-2xl font-bold">
                {lastSync ? formatDistanceToNow(new Date(lastSync.created_at), { locale: ptBR, addSuffix: true }) : "Nenhuma"}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {lastSync ? `Status: ${lastSync.status}` : "Execute uma sincronização."}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sincronização Automática</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              A cada 1 hora
            </div>
            <p className="text-xs text-muted-foreground">
              A tarefa é executada no início de cada hora.
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
    </div>
  );
};

export default Dashboard;