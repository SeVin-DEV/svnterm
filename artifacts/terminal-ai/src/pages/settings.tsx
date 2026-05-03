import { useGetAiSettings, useUpdateAiSettings, getGetAiSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Settings, Key, Globe, Cpu, MessageSquare, Eye, EyeOff, Github, CheckCircle, XCircle, Loader2, Brain } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { z } from "zod";
import { useEffect, useState } from "react";

const formSchema = z.object({
  apiKey: z.string().optional(),
  endpointUrl: z.string().url("Must be a valid URL").or(z.literal("")),
  modelName: z.string().min(1, "Model name is required"),
  systemPrompt: z.string().optional(),
  githubToken: z.string().optional(),
  githubRepo: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settings = useGetAiSettings();
  const updateSettings = useUpdateAiSettings();
  const [showKey, setShowKey] = useState(false);
  const [showGhToken, setShowGhToken] = useState(false);
  const [ghVerifying, setGhVerifying] = useState(false);
  const [ghVerifyResult, setGhVerifyResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { apiKey: "", endpointUrl: "", modelName: "", systemPrompt: "", githubToken: "", githubRepo: "" },
  });

  useEffect(() => {
    if (settings.data) {
      form.reset({
        apiKey: "",
        endpointUrl: settings.data.endpointUrl ?? "https://api.openai.com/v1",
        modelName: settings.data.modelName ?? "gpt-4o",
        systemPrompt: settings.data.systemPrompt ?? "",
        githubToken: "",
        githubRepo: settings.data.githubRepo ?? "",
      });
    }
  }, [settings.data]);

  function onSubmit(values: FormValues) {
    const body: Record<string, string> = {};
    if (values.apiKey?.trim()) body.apiKey = values.apiKey.trim();
    if (values.endpointUrl) body.endpointUrl = values.endpointUrl;
    if (values.modelName) body.modelName = values.modelName;
    if (values.systemPrompt !== undefined) body.systemPrompt = values.systemPrompt ?? "";
    if (values.githubToken !== undefined) body.githubToken = values.githubToken ?? "";
    if (values.githubRepo !== undefined) body.githubRepo = values.githubRepo ?? "";

    updateSettings.mutate(
      { data: body },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAiSettingsQueryKey() });
          form.setValue("apiKey", "");
          form.setValue("githubToken", "");
          setGhVerifyResult(null);
          toast({ title: "Settings saved" });
        },
        onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
      }
    );
  }

  async function verifyGitHub() {
    const token = form.getValues("githubToken")?.trim();
    const repo = form.getValues("githubRepo")?.trim();
    if (!token && !settings.data?.hasGithubToken) {
      toast({ title: "Enter your GitHub token first", variant: "destructive" }); return;
    }
    if (!repo) {
      toast({ title: "Enter a repo (owner/repo)", variant: "destructive" }); return;
    }
    setGhVerifying(true); setGhVerifyResult(null);
    try {
      const res = await fetch("/api/github/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token || "(stored)", repo }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      setGhVerifyResult(data);
    } catch {
      setGhVerifyResult({ ok: false, error: "Network error" });
    } finally {
      setGhVerifying(false);
    }
  }

  const presets = [
    { label: "OpenAI", endpoint: "https://api.openai.com/v1", model: "gpt-4o" },
    { label: "Anthropic", endpoint: "https://api.anthropic.com/v1", model: "claude-3-5-sonnet-20241022" },
    { label: "Together AI", endpoint: "https://api.together.xyz/v1", model: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo" },
    { label: "OpenRouter", endpoint: "https://openrouter.ai/api/v1", model: "openai/gpt-4o" },
    { label: "Groq", endpoint: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
    { label: "Local (Ollama)", endpoint: "http://localhost:11434/v1", model: "llama3.2" },
  ];

  const DEFAULT_SYSTEM_PROMPT = `You are an expert SSH terminal assistant embedded directly in a terminal application. You have DIRECT ACCESS to run commands on the connected SSH server — never refuse or claim you cannot. You can read terminal output, suggest commands, run them, and in agent mode execute tasks autonomously. Be concise, direct, and technical.`;

  return (
    <div className="flex flex-col h-full overflow-y-auto" data-testid="settings-page">
      <div className="p-4 md:p-6 max-w-xl w-full mx-auto space-y-5 pb-8">
        <div className="flex items-center gap-2 mb-1">
          <Settings className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground font-mono">AI Settings</h1>
        </div>
        <p className="text-xs text-muted-foreground -mt-3">Configure your LLM provider, system prompt, and GitHub memory.</p>

        {settings.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading...
          </div>
        ) : (
          <>
            {/* Provider presets */}
            <Card className="p-4 bg-card border-card-border">
              <h2 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-primary" /> Quick Presets
              </h2>
              <div className="flex flex-wrap gap-2">
                {presets.map(p => (
                  <Button key={p.label} variant="outline" size="sm" className="text-xs font-mono h-9"
                    onClick={() => { form.setValue("endpointUrl", p.endpoint); form.setValue("modelName", p.model); }}
                    data-testid={`button-preset-${p.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </Card>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">

                {/* API Credentials */}
                <Card className="p-4 bg-card border-card-border space-y-4">
                  <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Key className="w-4 h-4 text-primary" /> API Credentials
                  </h2>
                  {settings.data?.hasApiKey && (
                    <div className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2 font-mono flex items-center gap-2">
                      <Key className="w-3 h-3 text-primary" />
                      Current key: {settings.data.apiKey ?? "****"}
                      <span className="ml-auto text-primary">Active</span>
                    </div>
                  )}
                  <FormField control={form.control} name="apiKey" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm">API Key {settings.data?.hasApiKey ? "(leave blank to keep)" : ""}</FormLabel>
                      <div className="relative">
                        <FormControl>
                          <Input type={showKey ? "text" : "password"} placeholder="sk-..." className="font-mono pr-10 h-11" {...field} data-testid="input-api-key" />
                        </FormControl>
                        <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )} />
                </Card>

                {/* Endpoint */}
                <Card className="p-4 bg-card border-card-border space-y-4">
                  <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary" /> Endpoint & Model
                  </h2>
                  <FormField control={form.control} name="endpointUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm">Endpoint URL</FormLabel>
                      <FormControl>
                        <Input placeholder="https://api.openai.com/v1" className="font-mono text-sm h-11" {...field} data-testid="input-endpoint-url" />
                      </FormControl>
                      <FormDescription className="text-xs">Any OpenAI-compatible API base URL</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="modelName" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm">Model Name</FormLabel>
                      <FormControl>
                        <Input placeholder="gpt-4o" className="font-mono text-sm h-11" {...field} data-testid="input-model-name" />
                      </FormControl>
                      <FormDescription className="text-xs">Model identifier for chat completions</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </Card>

                {/* System Prompt */}
                <Card className="p-4 bg-card border-card-border space-y-3">
                  <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-primary" /> System Prompt
                  </h2>
                  <div className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2 leading-relaxed">
                    This tells the AI who it is and what it can do. If left blank, a default prompt is used that gives the AI direct terminal access without argument.
                  </div>
                  <Button type="button" variant="outline" size="sm" className="text-xs h-9 w-full"
                    onClick={() => form.setValue("systemPrompt", DEFAULT_SYSTEM_PROMPT)}>
                    Use recommended default
                  </Button>
                  <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea placeholder={DEFAULT_SYSTEM_PROMPT} className="font-mono text-xs h-28 resize-none" {...field} data-testid="input-system-prompt" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </Card>

                {/* GitHub Memory Sync */}
                <Card className="p-4 bg-card border-card-border space-y-4">
                  <div>
                    <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Brain className="w-4 h-4 text-primary" /> AI Memory (GitHub Sync)
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Connect a GitHub repo to give the AI persistent memory across sessions. Chat transcripts, a memory file, and the AI's own notes are stored there and injected back into every conversation.
                    </p>
                  </div>

                  <div className="space-y-3 bg-muted/20 rounded-lg p-3 border border-border text-xs text-muted-foreground leading-relaxed">
                    <p><strong className="text-foreground">What gets stored:</strong></p>
                    <ul className="space-y-1 ml-2">
                      <li>• <code className="text-primary">memory.md</code> — AI's running notes (writable by the AI and you)</li>
                      <li>• <code className="text-primary">sessions/YYYY-MM-DD_HH-MM-SS.md</code> — full session transcripts (saved on clear or auto every 10 turns)</li>
                    </ul>
                    <p className="mt-2"><strong className="text-foreground">How the AI remembers:</strong> Include <code className="text-primary">[MEMORY: note]</code> anywhere in a response to auto-save a note. Say "remember this" or "don't forget" and it saves your message too.</p>
                    <p><strong className="text-foreground">Token needs:</strong> repo read+write scope on the target repo.</p>
                  </div>

                  {settings.data?.hasGithubToken && (
                    <div className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2 font-mono flex items-center gap-2">
                      <Github className="w-3 h-3 text-primary" />
                      Token: active
                      {settings.data.githubRepo && <span className="ml-auto text-primary">{settings.data.githubRepo}</span>}
                    </div>
                  )}

                  <FormField control={form.control} name="githubToken" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm">GitHub Personal Access Token {settings.data?.hasGithubToken ? "(leave blank to keep)" : ""}</FormLabel>
                      <div className="relative">
                        <FormControl>
                          <Input type={showGhToken ? "text" : "password"} placeholder="ghp_..." className="font-mono pr-10 h-11 text-sm" {...field} data-testid="input-github-token" />
                        </FormControl>
                        <button type="button" onClick={() => setShowGhToken(!showGhToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                          {showGhToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <FormDescription className="text-xs">Create at github.com → Settings → Developer settings → Personal access tokens → repo scope</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="githubRepo" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm">Repository</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input placeholder="yourname/ai-memory" className="font-mono h-11 text-sm flex-1" {...field} data-testid="input-github-repo" />
                        </FormControl>
                        <Button type="button" variant="outline" className="h-11 px-3 shrink-0 text-xs" onClick={verifyGitHub} disabled={ghVerifying} data-testid="button-verify-github">
                          {ghVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : "Test"}
                        </Button>
                      </div>
                      <FormDescription className="text-xs">Format: owner/repo — the repo must already exist</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {ghVerifyResult && (
                    <div className={`flex items-center gap-2 text-xs rounded px-3 py-2 ${ghVerifyResult.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                      {ghVerifyResult.ok
                        ? <><CheckCircle className="w-4 h-4 shrink-0" /> Connected! Repo is accessible.</>
                        : <><XCircle className="w-4 h-4 shrink-0" /> {ghVerifyResult.error}</>}
                    </div>
                  )}
                </Card>

                <Button type="submit" disabled={updateSettings.isPending} className="w-full h-12 text-sm" data-testid="button-save-settings">
                  {updateSettings.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Saving...</> : "Save Settings"}
                </Button>
              </form>
            </Form>
          </>
        )}
      </div>
    </div>
  );
}
