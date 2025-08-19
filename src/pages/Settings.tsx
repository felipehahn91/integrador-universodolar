import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { showSuccess, showError, showLoading } from "@/utils/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

const Settings = () => {
  const [batchSize, setBatchSize] = useState(50);
  const [excludedDomains, setExcludedDomains] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isJobRunning, setIsJobRunning] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      const { data, error } = await supabase.from("settings").select("*").eq("singleton_key", 1).single();
      if (error) { showError("Erro ao carregar configurações."); console.error(error); } 
      else if (data) { setBatchSize(data.batch_size); setExcludedDomains(data.excluded_domains.join("\n")); }
      setLoading(false);
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    const domainsArray = excludedDomains.split("\n").filter(d => d.trim() !== "");
    const { error: updateError } = await supabase.from("settings").update({ batch_size: batchSize, excluded_domains: domainsArray }).eq("singleton_key", 1);
    if (updateError) { showError("Erro ao salvar configurações."); } 
    else { showSuccess("Configurações salvas com sucesso!"); }
    setIsSaving(false);
  };

  const startMassiveJob = async (jobName: string, functionName: string) => {
    setIsJobRunning(true);
    const toastId = showLoading(`Iniciando ${jobName}...`);
    try {
      const { data, error } = await supabase.functions.invoke(functionName);
      if (error) throw error;
      
      toast.success(`${jobName} iniciada com sucesso! Você pode acompanhar o progresso no Dashboard.`, {
        id: toastId,
        action: {
          label: "Ver Job",
          onClick: () => navigate(`/sync-job/${data.jobId}`),
        },
      });
      queryClient.invalidateQueries({ queryKey: ['sync_history'] });
    } catch (error: any) {
      showError(`Falha ao iniciar a tarefa: ${error.message}`, { id: toastId });
    } finally {
      setIsJobRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Configurações Gerais</CardTitle><CardDescription>Ajuste os parâmetros de sincronização da aplicação. A sincronização automática está configurada para rodar a cada hora.</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="space-y-6"><Skeleton className="h-4 w-40" /><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-56" /><Skeleton className="h-24 w-full" /><Skeleton className="h-10 w-32" /></div>
          ) : (
            <>
              <div className="space-y-2"><Label htmlFor="batchSize">Tamanho do Lote (Batch Size)</Label><Input id="batchSize" type="number" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} /><p className="text-sm text-muted-foreground">Número de registros a serem processados por vez nas tarefas em massa.</p></div>
              <div className="space-y-2"><Label htmlFor="excludedDomains">Domínios de E-mail Excluídos</Label><Textarea id="excludedDomains" placeholder="Um domínio por linha..." value={excludedDomains} onChange={(e) => setExcludedDomains(e.target.value)} rows={10} /><p className="text-sm text-muted-foreground">Contatos com e-mails desses domínios serão ignorados.</p></div>
              <Button onClick={handleSave} disabled={isSaving}>{isSaving ? "Salvando..." : "Salvar Configurações"}</Button>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Atualização de Dados em Massa</CardTitle><CardDescription>Execute estas ações para preencher dados de contatos e pedidos já existentes. Apenas uma tarefa pode ser executada por vez.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div><h3 className="font-semibold mb-2">Sincronização Histórica com Mautic</h3><p className="text-sm text-muted-foreground mb-3">Enviar toda a base de contatos existente para o Mautic. Use esta opção uma vez para popular o Mautic com dados antigos.</p><Button onClick={() => startMassiveJob("Sincronização com Mautic", "start-mautic-backfill")} disabled={isJobRunning}><RefreshCw className={`mr-2 h-4 w-4 ${isJobRunning ? 'animate-spin' : ''}`} />Sincronizar Base Completa com Mautic</Button></div>
          <div><h3 className="font-semibold mb-2">Atualizar Detalhes dos Contatos</h3><p className="text-sm text-muted-foreground mb-3">Busca os dados mais recentes de todos os contatos, incluindo o telefone. Útil para preencher informações de contatos antigos.</p><Button onClick={() => { /* Lógica futura para job de detalhes */ }} disabled={isJobRunning}><RefreshCw className={`mr-2 h-4 w-4 ${isJobRunning ? 'animate-spin' : ''}`} />Atualizar Contatos</Button></div>
          <div><h3 className="font-semibold mb-2">Sincronização Histórica de Pedidos</h3><p className="text-sm text-muted-foreground mb-3">Busca o histórico de pedidos de todos os contatos. Use após importar contatos pela primeira vez.</p><Button onClick={() => { /* Lógica futura para job de pedidos */ }} disabled={isJobRunning}><RefreshCw className={`mr-2 h-4 w-4 ${isJobRunning ? 'animate-spin' : ''}`} />Sincronizar Pedidos Históricos</Button></div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Settings;