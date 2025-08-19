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
import { Separator } from "@/components/ui/separator";
import { RefreshCw } from "lucide-react";

const BATCH_SIZE = 25;

const Settings = () => {
  const [syncInterval, setSyncInterval] = useState(6);
  const [batchSize, setBatchSize] = useState(50);
  const [excludedDomains, setExcludedDomains] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ currentPage: number, totalPages: number } | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("settings")
        .select("*")
        .eq("singleton_key", 1)
        .single();

      if (error) {
        showError("Erro ao carregar configurações.");
        console.error(error);
      } else if (data) {
        setSyncInterval(data.sync_interval_hours || 6); 
        setBatchSize(data.batch_size);
        setExcludedDomains(data.excluded_domains.join("\n"));
      }
      setLoading(false);
    };

    fetchSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    const domainsArray = excludedDomains.split("\n").filter(d => d.trim() !== "");
    
    const { error: updateError } = await supabase
      .from("settings")
      .update({
        sync_interval_hours: syncInterval,
        batch_size: batchSize,
        excluded_domains: domainsArray,
      })
      .eq("singleton_key", 1);

    if (updateError) {
      showError("Erro ao salvar configurações.");
      console.error(updateError);
      setIsSaving(false);
      return;
    }

    const { error: functionError } = await supabase.functions.invoke('update-sync-schedule', {
      body: { intervalHours: syncInterval },
    });

    if (functionError) {
      showError("Configurações salvas, mas falha ao reagendar a tarefa automática.");
      console.error(functionError);
    } else {
      showSuccess("Configurações salvas e tarefa automática reagendada com sucesso!");
    }
    
    setIsSaving(false);
  };

  const handleBackfill = async () => {
    setIsBackfilling(true);
    const toastId = showLoading("Iniciando sincronização histórica...");

    try {
      const { count, error: countError } = await supabase
        .from('magazord_contacts')
        .select('*', { count: 'exact', head: true });

      if (countError) throw countError;
      if (!count || count === 0) {
        showSuccess("Nenhum contato para processar.");
        return;
      }

      const totalPages = Math.ceil(count / BATCH_SIZE);
      
      for (let page = 1; page <= totalPages; page++) {
        setBackfillProgress({ currentPage: page, totalPages });
        toast.loading(`Processando lote ${page} de ${totalPages}...`, { id: toastId });
        
        const { error: invokeError } = await supabase.functions.invoke('backfill-orders', {
          body: { page },
        });

        if (invokeError) {
          throw new Error(`Erro no lote ${page}: ${invokeError.message}`);
        }
      }

      toast.success("Sincronização histórica concluída com sucesso!", { id: toastId });
    } catch (error) {
      showError(`Falha na sincronização: ${error.message}`);
      toast.dismiss(toastId);
    } finally {
      setIsBackfilling(false);
      setBackfillProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Configurações Gerais</CardTitle>
          <CardDescription>Ajuste os parâmetros de sincronização da aplicação.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="space-y-6">
              <Skeleton className="h-4 w-48" /><Skeleton className="h-10 w-full" />
              <Skeleton className="h-4 w-40" /><Skeleton className="h-10 w-full" />
              <Skeleton className="h-4 w-56" /><Skeleton className="h-24 w-full" />
              <Skeleton className="h-10 w-32" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="syncInterval">Intervalo de Sincronização Automática (horas)</Label>
                <Input id="syncInterval" type="number" min="1" value={syncInterval} onChange={(e) => setSyncInterval(Number(e.target.value))} />
                <p className="text-sm text-muted-foreground">Define a frequência com que a sincronização automática será executada.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="batchSize">Tamanho do Lote (Batch Size)</Label>
                <Input id="batchSize" type="number" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="excludedDomains">Domínios de E-mail Excluídos</Label>
                <Textarea id="excludedDomains" placeholder="Um domínio por linha..." value={excludedDomains} onChange={(e) => setExcludedDomains(e.target.value)} rows={10} />
                <p className="text-sm text-muted-foreground">Contatos com e-mails desses domínios serão ignorados.</p>
              </div>
              <Button onClick={handleSave} disabled={isSaving}>{isSaving ? "Salvando..." : "Salvar Configurações"}</Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sincronização Histórica de Pedidos</CardTitle>
          <CardDescription>
            Execute esta ação para buscar e salvar o histórico de pedidos de todos os contatos já importados.
            Este processo pode levar vários minutos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleBackfill} disabled={isBackfilling}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isBackfilling ? 'animate-spin' : ''}`} />
            {isBackfilling ? `Processando... ${backfillProgress ? `${backfillProgress.currentPage}/${backfillProgress.totalPages}` : ''}` : "Iniciar Sincronização Histórica"}
          </Button>
          {isBackfilling && backfillProgress && (
            <p className="text-sm text-muted-foreground mt-2">
              Processando lote {backfillProgress.currentPage} de {backfillProgress.totalPages}. Não feche esta página.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Settings;