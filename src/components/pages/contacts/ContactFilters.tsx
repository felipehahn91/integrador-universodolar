import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

export interface Filters {
  searchTerm: string;
  sortBy: string;
}

interface ContactFiltersProps {
  filters: Filters;
  onFiltersChange: (newFilters: Partial<Filters>) => void;
}

export const ContactFilters = ({ filters, onFiltersChange }: ContactFiltersProps) => {
  const [internalSearch, setInternalSearch] = useState(filters.searchTerm);

  useEffect(() => {
    const handler = setTimeout(() => {
      onFiltersChange({ searchTerm: internalSearch });
    }, 500);
    return () => clearTimeout(handler);
  }, [internalSearch, onFiltersChange]);

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
        </SelectContent>
      </Select>
    </div>
  );
};