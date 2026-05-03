import { useState } from "react";
import { useListSnippets, useCreateSnippet, useUpdateSnippet, useDeleteSnippet, getListSnippetsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Code2, Copy } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { z } from "zod";

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  command: z.string().min(1, "Command is required"),
  description: z.string().optional(),
  category: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

export default function SnippetsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const snippets = useListSnippets();
  const createSnippet = useCreateSnippet();
  const updateSnippet = useUpdateSnippet();
  const deleteSnippet = useDeleteSnippet();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", command: "", description: "", category: "" },
  });

  function openCreate() {
    setEditingId(null);
    form.reset({ title: "", command: "", description: "", category: "" });
    setDialogOpen(true);
  }

  function openEdit(s: { id: number; title: string; command: string; description?: string | null; category?: string | null }) {
    setEditingId(s.id);
    form.reset({ title: s.title, command: s.command, description: s.description ?? "", category: s.category ?? "" });
    setDialogOpen(true);
  }

  function onSubmit(values: FormValues) {
    const body = { title: values.title, command: values.command, description: values.description, category: values.category };
    if (editingId) {
      updateSnippet.mutate({ id: editingId, data: body }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListSnippetsQueryKey() }); setDialogOpen(false); toast({ title: "Snippet updated" }); },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      });
    } else {
      createSnippet.mutate({ data: body }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListSnippetsQueryKey() }); setDialogOpen(false); toast({ title: "Snippet saved" }); },
        onError: () => toast({ title: "Failed to save", variant: "destructive" }),
      });
    }
  }

  const filtered = (snippets.data ?? []).filter(s =>
    s.title.toLowerCase().includes(filter.toLowerCase()) ||
    s.command.toLowerCase().includes(filter.toLowerCase()) ||
    (s.category ?? "").toLowerCase().includes(filter.toLowerCase())
  );

  const categories = [...new Set((snippets.data ?? []).map(s => s.category).filter(Boolean))];

  return (
    <div className="flex flex-col h-full p-6 overflow-auto" data-testid="snippets-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground font-mono">Command Snippets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Quick access to your most-used commands</p>
        </div>
        <Button onClick={openCreate} size="sm" data-testid="button-add-snippet">
          <Plus className="w-4 h-4 mr-1.5" /> New Snippet
        </Button>
      </div>

      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Filter by name, command, or category..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-sm"
          data-testid="input-filter-snippets"
        />
      </div>

      {snippets.isLoading ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">Loading...</div>
      ) : !filtered.length ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3">
          <Code2 className="w-10 h-10 text-muted-foreground opacity-40" />
          <p className="text-muted-foreground text-sm">{filter ? "No snippets match your filter" : "No snippets saved yet"}</p>
          {!filter && <Button variant="outline" size="sm" onClick={openCreate}>Add your first snippet</Button>}
        </div>
      ) : (
        <div className="grid gap-2 max-w-2xl">
          {filtered.map((s) => (
            <Card key={s.id} className="p-3 border border-card-border bg-card" data-testid={`card-snippet-${s.id}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm text-foreground">{s.title}</span>
                    {s.category && (
                      <Badge variant="outline" className="text-xs border-border text-muted-foreground">{s.category}</Badge>
                    )}
                  </div>
                  <code className="text-xs text-primary font-mono bg-muted/40 px-2 py-1 rounded block truncate">
                    {s.command}
                  </code>
                  {s.description && (
                    <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => { navigator.clipboard.writeText(s.command); toast({ title: "Copied!" }); }}
                    data-testid={`button-copy-snippet-${s.id}`}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)} data-testid={`button-edit-snippet-${s.id}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(s.id)} data-testid={`button-delete-snippet-${s.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-card-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono">{editingId ? "Edit Snippet" : "New Snippet"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl><Input placeholder="Check disk usage" {...field} data-testid="input-snippet-title" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="command" render={({ field }) => (
                <FormItem>
                  <FormLabel>Command</FormLabel>
                  <FormControl><Textarea placeholder="df -h" className="font-mono text-sm h-20 resize-none" {...field} data-testid="input-snippet-command" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category (optional)</FormLabel>
                    <FormControl><Input placeholder="System" {...field} data-testid="input-snippet-category" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl><Input placeholder="Show disk usage" {...field} data-testid="input-snippet-description" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createSnippet.isPending || updateSnippet.isPending} data-testid="button-submit-snippet">
                  {editingId ? "Save Changes" : "Save Snippet"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="bg-card border-card-border max-w-sm">
          <DialogHeader><DialogTitle>Delete Snippet</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure? This action cannot be undone.</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteSnippet.mutate({ id: deleteId }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListSnippetsQueryKey() }); setDeleteId(null); toast({ title: "Deleted" }); }, onError: () => toast({ title: "Failed", variant: "destructive" }) })} disabled={deleteSnippet.isPending} data-testid="button-confirm-delete-snippet">
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
