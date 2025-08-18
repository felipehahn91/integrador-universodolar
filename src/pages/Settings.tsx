import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { showSuccess, showError } from "@/utils/toast";
import { Skeleton } from "@/components/ui/skeleton";

const Settings = () => {
  const [syncInterval, setSyncInterval] = useState(5);
  const [batchSize, setBatchSize] = useState(50);
  const [excludedDomains, setExcludedDomains] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

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
        setSyncInterval(data.sync_interval_minutes);
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
    
    const { error } = await supabase
      .from("settings")
      .update({
        sync_interval_minutes: syncInterval,
        batch_size: batchSize,
        excluded_domains: domainsArray,
      })
      .eq("singleton_key", 1);

    if (error) {
      showError("Erro ao salvar configurações.");
      console.error(error);
    } else {
      showSuccess("Configurações salvas com sucesso!");
    }
    setIsSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configurações</CardTitle>
        <CardDescription>Ajuste os parâmetros de sincronização da aplicação.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-24 w-full" />
            </div>
            <Skeleton className="h-10 w-32" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="syncInterval">Intervalo de Sincronização (minutos)</Label>
              <Input
                id="syncInterval"
                type="number"
                value={syncInterval}
                onChange={(e) => setSyncInterval(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batchSize">Tamanho do Lote (Batch Size)</Label>
              <Input
                id="batchSize"
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="excludedDomains">Domínios de E-mail Excluídos</Label>
              <Textarea
                id="excludedDomains"
                placeholder="Um domínio por linha, ex: mail.mercadolivre.com"
                value={excludedDomains}
                onChange={(e) => setExcludedDomains(e.target.value)}
                rows={10}
              />
              <p className="text-sm text-muted-foreground">
                Contatos com e-mails desses domínios serão ignorados.
              </p>
            </div>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Salvando..." : "Salvar Configurações"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default Settings;