import { useState } from "react";
import { useListSshConnections, useCreateSshConnection, useUpdateSshConnection, useDeleteSshConnection, getListSshConnectionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Server } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { z } from "zod";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  host: z.string().min(1, "Host is required"),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  username: z.string().min(1, "Username is required"),
  authType: z.enum(["password", "key"]),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

export default function ConnectionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const connections = useListSshConnections();
  const createConn = useCreateSshConnection();
  const updateConn = useUpdateSshConnection();
  const deleteConn = useDeleteSshConnection();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", host: "", port: 22, username: "", authType: "password" },
  });

  const authType = form.watch("authType");

  function openCreate() {
    setEditingId(null);
    form.reset({ name: "", host: "", port: 22, username: "", authType: "password" });
    setDialogOpen(true);
  }

  function openEdit(conn: NonNullable<ReturnType<typeof useListSshConnections>>[number]) {
    setEditingId(conn.id);
    form.reset({
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      authType: conn.authType as "password" | "key",
    });
    setDialogOpen(true);
  }

  function onSubmit(values: FormValues) {
    const body = {
      name: values.name,
      host: values.host,
      port: values.port,
      username: values.username,
      authType: values.authType,
      password: values.password,
      privateKey: values.privateKey,
      passphrase: values.passphrase,
    };

    if (editingId) {
      updateConn.mutate(
        { id: editingId, data: body },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSshConnectionsQueryKey() });
            setDialogOpen(false);
            toast({ title: "Connection updated" });
          },
          onError: () => toast({ title: "Failed to update", variant: "destructive" }),
        }
      );
    } else {
      createConn.mutate(
        { data: body },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSshConnectionsQueryKey() });
            setDialogOpen(false);
            toast({ title: "Connection saved" });
          },
          onError: () => toast({ title: "Failed to save", variant: "destructive" }),
        }
      );
    }
  }

  function confirmDelete(id: number) {
    deleteConn.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSshConnectionsQueryKey() });
          setDeleteId(null);
          toast({ title: "Connection deleted" });
        },
        onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="flex flex-col h-full p-6 overflow-auto" data-testid="connections-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground font-mono">SSH Connections</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your saved server credentials</p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-connection" size="sm">
          <Plus className="w-4 h-4 mr-1.5" /> New Connection
        </Button>
      </div>

      {connections.isLoading ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">Loading...</div>
      ) : !connections.data?.length ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3">
          <Server className="w-10 h-10 text-muted-foreground opacity-40" />
          <p className="text-muted-foreground text-sm">No connections saved yet</p>
          <Button variant="outline" size="sm" onClick={openCreate}>Add your first server</Button>
        </div>
      ) : (
        <div className="grid gap-3 max-w-2xl">
          {connections.data.map((conn) => (
            <Card key={conn.id} className="p-4 flex items-center gap-4 border border-card-border bg-card" data-testid={`card-connection-${conn.id}`}>
              <div className="w-9 h-9 rounded bg-primary/10 flex items-center justify-center shrink-0">
                <Server className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-foreground font-mono">{conn.name}</span>
                  <Badge variant="outline" className="text-xs font-mono border-border text-muted-foreground">
                    {conn.authType === "key" ? "key" : "password"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                  {conn.username}@{conn.host}:{conn.port}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(conn)} data-testid={`button-edit-connection-${conn.id}`}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteId(conn.id)} data-testid={`button-delete-connection-${conn.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-card-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono">{editingId ? "Edit Connection" : "New Connection"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input placeholder="My Server" {...field} data-testid="input-connection-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="host" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Host</FormLabel>
                    <FormControl><Input placeholder="192.168.1.1" className="font-mono" {...field} data-testid="input-connection-host" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="port" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl><Input type="number" placeholder="22" className="font-mono" {...field} data-testid="input-connection-port" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="username" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input placeholder="root" className="font-mono" {...field} data-testid="input-connection-username" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="authType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Auth Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-auth-type">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="password">Password</SelectItem>
                        <SelectItem value="key">Private Key</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {authType === "password" && (
                <FormField control={form.control} name="password" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl><Input type="password" placeholder="••••••••" {...field} data-testid="input-connection-password" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              {authType === "key" && (
                <>
                  <FormField control={form.control} name="privateKey" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Private Key</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
                          className="font-mono text-xs h-28 resize-none"
                          {...field}
                          data-testid="input-connection-private-key"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="passphrase" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Passphrase (optional)</FormLabel>
                      <FormControl><Input type="password" placeholder="Key passphrase" {...field} data-testid="input-connection-passphrase" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createConn.isPending || updateConn.isPending} data-testid="button-submit-connection">
                  {editingId ? "Save Changes" : "Save Connection"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="bg-card border-card-border max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Connection</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure? This action cannot be undone.</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && confirmDelete(deleteId)} disabled={deleteConn.isPending} data-testid="button-confirm-delete">
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
