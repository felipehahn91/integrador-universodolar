import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { ContactFilters, Filters } from "@/components/pages/contacts/ContactFilters";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const PAGE_SIZE = 15;

const fetchFilteredContacts = async (page: number, filters: Filters) => {
  const lastUnderscoreIndex = filters.sortBy.lastIndexOf('_');
  const sortBy = filters.sortBy.substring(0, lastUnderscoreIndex);
  const sortDirection = filters.sortBy.substring(lastUnderscoreIndex + 1);
  
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('magazord_contacts')
    .select('id, nome, email, created_at, valor_total_gasto', { count: 'exact' });

  if (filters.searchTerm) {
    const searchTerm = filters.searchTerm;
    query = query.or(`nome.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
  }

  query = query.order(sortBy, { ascending: sortDirection === 'asc' });
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error("Supabase query error:", error);
    throw new Error(`Erro na busca: ${error.message}`);
  }
  
  return { contacts: data, count };
};

const Contacts = () => {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<Filters>({
    searchTerm: "",
    sortBy: "created_at_desc",
  });

  const handleFiltersChange = (newFilters: Partial<Filters>) => {
    setCurrentPage(1);
    setFilters(prev => ({ ...prev, ...newFilters }));
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["filtered_contacts", currentPage, filters],
    queryFn: () => fetchFilteredContacts(currentPage, filters),
    keepPreviousData: true,
  });

  const contacts = data?.contacts;
  const totalContacts = data?.count ?? 0;
  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Contatos Sincronizados</CardTitle>
          <CardDescription>Busque e visualize os contatos importados da Magazord.</CardDescription>
        </CardHeader>
        <CardContent>
          <ContactFilters filters={filters} onFiltersChange={handleFiltersChange} />
          {isError ? (
            <div className="text-center py-8 text-red-600">
              <p>Ocorreu um erro ao buscar os contatos. Tente novamente.</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Data de Cadastro</TableHead>
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
                          {contact.created_at ? format(new Date(contact.created_at), "dd/MM/yyyy", { locale: ptBR }) : '—'}
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Contacts;