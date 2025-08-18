import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const fetchContactDetails = async (contactId: string) => {
  const { data, error } = await supabase
    .from("magazord_contacts")
    .select("*")
    .eq("id", contactId)
    .single();
  if (error) throw new Error(error.message);
  return data;
};

const fetchContactOrders = async (contactId: string) => {
  const { data, error } = await supabase
    .from("magazord_orders")
    .select("*")
    .eq("contact_id", contactId)
    .order("data_pedido", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
};

const ContactDetails = () => {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();

  const { data: contact, isLoading: isLoadingContact } = useQuery({
    queryKey: ["contact_details", contactId],
    queryFn: () => fetchContactDetails(contactId!),
    enabled: !!contactId,
  });

  const { data: orders, isLoading: isLoadingOrders } = useQuery({
    queryKey: ["contact_orders", contactId],
    queryFn: () => fetchContactOrders(contactId!),
    enabled: !!contactId,
  });

  return (
    <div className="space-y-6">
      <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Voltar
      </Button>

      <Card>
        <CardHeader>
          {isLoadingContact ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ) : (
            <>
              <CardTitle>{contact?.nome}</CardTitle>
              <CardDescription>{contact?.email}</CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent>
          {isLoadingContact ? (
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="font-medium">CPF/CNPJ</p>
                <p className="text-muted-foreground">{contact?.cpf_cnpj}</p>
              </div>
              <div>
                <p className="font-medium">Tipo</p>
                <p className="text-muted-foreground">
                  {contact?.tipo_pessoa === 'F' ? 'Pessoa Física' : 'Pessoa Jurídica'}
                </p>
              </div>
              <div>
                <p className="font-medium">Total de Compras</p>
                <p className="text-muted-foreground">{contact?.total_compras}</p>
              </div>
              <div>
                <p className="font-medium">Valor Total Gasto</p>
                <p className="text-muted-foreground">
                  {Number(contact?.valor_total_gasto).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de Pedidos</CardTitle>
          <CardDescription>Lista de todos os pedidos entregues.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID do Pedido</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingOrders ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : orders && orders.length > 0 ? (
                orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.magazord_order_id}</TableCell>
                    <TableCell>{new Date(order.data_pedido).toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell><Badge>{order.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {Number(order.valor_total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center">Nenhum pedido encontrado.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default ContactDetails;