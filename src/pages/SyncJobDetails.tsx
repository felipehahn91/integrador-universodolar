import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, CheckCircle, Clock, XCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { useEffect } from "react";

const fetchJobDetails = async (jobId: string) => {
  const { data, error } = await supabase
    .from("sync_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error) throw new Error(error.message);
  return data;
};

const SyncJobDetails = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: job, isLoading } = useQuery({
    queryKey: ["sync_job_details", jobId],
    queryFn: () => fetchJobDetails(jobId!),
    enabled: !!jobId,
  });

  useEffect(() => {
    if (!jobId) return;

    const channel = supabase
      .channel(`sync_job_details_${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sync_jobs',
          filter: `id=eq.${jobId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["sync_job_details", jobId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, queryClient]);

  const formatStatus = (status: string) => {
    switch (status) {
      case 'completed': return <Badge variant="default"><CheckCircle className="mr-2 h-4 w-4" />Concluído</Badge>;
      case 'running': return <Badge variant="secondary"><Clock className="mr-2 h-4 w-4 animate-spin" />Executando...</Badge>;
      case 'failed': return <Badge variant="destructive"><XCircle className="mr-2 h-4 w-4" />Falhou</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Voltar para o Histórico
      </Button>

      <Card>
        <CardHeader>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ) : (
            <>
              <CardTitle>Detalhes da Sincronização</CardTitle>
              <CardDescription>ID do Job: {job?.id}</CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-6">
              <div>
                <p className="font-medium">Status</p>
                <div className="mt-1">{formatStatus(job?.status)}</div>
              </div>
              <div>
                <p className="font-medium">Início</p>
                <p className="text-muted-foreground flex items-center mt-1">
                  <Calendar className="mr-2 h-4 w-4" />
                  {job?.created_at ? format(new Date(job.created_at), "dd/MM/yy HH:mm:ss", { locale: ptBR }) : '—'}
                </p>
              </div>
              <div>
                <p className="font-medium">Fim</p>
                <p className="text-muted-foreground flex items-center mt-1">
                  <Calendar className="mr-2 h-4 w-4" />
                  {job?.finished_at ? format(new Date(job.finished_at), "dd/MM/yy HH:mm:ss", { locale: ptBR }) : '—'}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logs</CardTitle>
          <CardDescription>Registro detalhado de eventos da sincronização.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-5/6" />
            </div>
          ) : (
            <div className="bg-muted/50 p-4 rounded-lg font-mono text-sm max-h-96 overflow-y-auto">
              {job?.logs && job.logs.length > 0 ? (
                job.logs.map((log, index) => <p key={index}>{log}</p>)
              ) : (
                <p>Nenhum log registrado para este job.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SyncJobDetails;