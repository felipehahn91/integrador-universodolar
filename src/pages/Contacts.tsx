import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

const PAGE_SIZE = 15;

const fetchContacts = async (page: number, searchTerm: string) => {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("magazord_contacts")
    .select("*", { count: 'exact' });

  if (searchTerm) {
    query = query.or(`nome.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);
  return { contacts: data, count };
};

const Contacts = () => {
  const navigate = useNavigate();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["magazord_contacts", currentPage, submittedSearch],
    queryFn: () => fetchContacts(currentPage, submittedSearch),
    keepPreviousData: true,
  });

  const contacts = data?.contacts;
  const totalContacts = data?.count ?? 0;
  const totalPages = Math.ceil(totalContacts / PAGE_SIZE);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    setSubmittedSearch(searchTerm);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contatos Sincronizados</CardTitle>
        <CardDescription>Busque e visualize os contatos importados da Magazord.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSearch} className="flex items-center gap-2 mb-4">
          <Input
            placeholder="Buscar por nome ou email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm"
          />
          <Button type="submit" variant="outline" size="icon">
            <Search className="h-4 w-4" />
          </Button>
        </form>
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
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-52" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : contacts && contacts.length > 0 ? (
              contacts.map((contact) => (
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
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="text-center">Nenhum contato encontrado.</TableCell>
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
  );
};

export default Contacts;