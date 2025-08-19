import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { ContactFilters, Filters } from "@/components/pages/contacts/ContactFilters";
import { StatsCards } from "@/components/pages/contacts/StatsCards";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const PAGE_SIZE = 15;

const fetchFilteredContacts = async (page: number, filters: Filters) => {
  const [sortBy, sortDirection] = filters.sortBy.split('_');
  
  const { data, error } = await supabase.rpc('get_filtered_contacts_with_stats', {
    p_search_term: filters.searchTerm || null,
    p_order_status_id: filters.orderStatus === 'all' ? null : Number(filters.orderStatus),
    p_has_orders: filters.hasOrders,
    p_sort_by: sortBy,
    p_sort_direction: sortDirection,
    p_page_number: page,
    p_page_size: PAGE_SIZE
  });

  if (error) throw new Error(error.message);
  return data;
};

const Contacts = () => {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({
    searchTerm: "",
    orderStatus: "all",
    hasOrders: false,
    sortBy: "created_at_desc",
  });

  const handleFiltersChange = (newFilters: Partial<Filters>) => {
    setCurrentPage(1);
    setFilters(prev => ({ ...prev, ...newFilters }));
  };

  const { data, isLoading } = useQuery({
    queryKey: ["filtered_contacts", currentPage, filters],
    queryFn: () => fetchFilteredContacts(currentPage, filters),
    keepPreviousData: true,
  });

  const contacts = data?.contacts;
  const stats = data?.stats;
  const totalContacts = data?.count ?? 0;
  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <StatsCards stats={stats} isLoading={isLoading} />
      <Card>
        <CardHeader>
          <CardTitle>Contatos Sincronizados</CardTitle>
          <CardDescription>Busque e visualize os contatos importados da Magazord.</CardDescription>
        </CardHeader>
        <CardContent>
          <ContactFilters filters={filters} onFiltersChange={handleFiltersChange} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Último Pedido</TableHead>
                <TableHead className="text-right">Total Gasto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-52" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : contacts && contacts.length > 0 ? (
                contacts.map((contact: any) => (
                  <TableRow
                    key={contact.id}
                    onClick={() => navigate(`/contact/${contact.id}`)}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <TableCell>{contact.nome}</TableCell>
                    <TableCell>{contact.email}</TableCell>
                    <TableCell>
                      {contact.last_order_date ? format(new Date(contact.last_order_date), "dd/MM/yyyy", { locale: ptBR }) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(contact.valor_total_gasto).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center">Nenhum contato encontrado com os filtros aplicados.</TableCell>
                </TableRow>
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

export default Contacts;