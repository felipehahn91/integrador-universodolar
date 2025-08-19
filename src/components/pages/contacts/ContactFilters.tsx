import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export interface Filters {
  searchTerm: string;
  orderStatus: string;
  hasOrders: boolean;
  sortBy: string;
}

interface ContactFiltersProps {
  filters: Filters;
  onFiltersChange: (newFilters: Partial<Filters>) => void;
}

const fetchOrderStatuses = async () => {
  const { data, error } = await supabase.from("order_statuses").select("id, description").order("description");
  if (error) throw new Error(error.message);
  return data;
};

export const ContactFilters = ({ filters, onFiltersChange }: ContactFiltersProps) => {
  const [internalSearch, setInternalSearch] = useState(filters.searchTerm);
  const { data: statuses } = useQuery({ queryKey: ["order_statuses"], queryFn: fetchOrderStatuses });

  useEffect(() => {
    const handler = setTimeout(() => {
      onFiltersChange({ searchTerm: internalSearch });
    }, 500);
    return () => clearTimeout(handler);
  }, [internalSearch]);

  return (
    <div className="flex flex-col md:flex-row items-center gap-4 p-4 bg-muted/50 rounded-lg mb-4">
      <div className="relative w-full md:flex-1">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Buscar por nome ou email..."
          className="pl-8 w-full"
          value={internalSearch}
          onChange={(e) => setInternalSearch(e.target.value)}
        />
      </div>
      <Select value={filters.sortBy} onValueChange={(value) => onFiltersChange({ sortBy: value })}>
        <SelectTrigger className="w-full md:w-48">
          <SelectValue placeholder="Ordenar por..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="created_at_desc">Mais Recentes</SelectItem>
          <SelectItem value="created_at_asc">Mais Antigos</SelectItem>
          <SelectItem value="last_order_date_desc">Último Pedido (Recente)</SelectItem>
          <SelectItem value="last_order_date_asc">Último Pedido (Antigo)</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.orderStatus} onValueChange={(value) => onFiltersChange({ orderStatus: value })}>
        <SelectTrigger className="w-full md:w-56">
          <SelectValue placeholder="Status do Pedido..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os Status</SelectItem>
          {statuses?.map(status => (
            <SelectItem key={status.id} value={String(status.id)}>{status.description}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center space-x-2">
        <Checkbox
          id="hasOrders"
          checked={filters.hasOrders}
          onCheckedChange={(checked) => onFiltersChange({ hasOrders: !!checked })}
        />
        <Label htmlFor="hasOrders" className="whitespace-nowrap">Apenas com pedidos</Label>
      </div>
    </div>
  );
};