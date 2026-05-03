import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Brain, RefreshCw, Save, CloudUpload, FileText, Loader2, ChevronRight, ArrowLeft, Clock, X } from "lucide-react";

interface MemoryFile {
  content: string | null;
  sha: string | null;
  configured: boolean;
}

interface SessionEntry {
  name: string;
  path: string;
  sha: string;
}

interface SessionsResponse {
  sessions: SessionEntry[];
  configured: boolean;
}

interface SelectedSession {
  name: string;
  content: string;
}

interface MemoryPanelProps {
  open: boolean;
  onClose: () => void;
  onSyncNow: () => Promise<void>;
  syncStatus: "idle" | "syncing" | "synced" | "error";
  lastSynced: Date | null;
}

type PanelTab = "memory" | "sessions";

function formatSessionName(filename: string): string {
  const raw = filename.replace(".md", "");
  const parts = raw.split("T");
  if (parts.length === 2) {
    const date = parts[0];
    const time = (parts[1] ?? "").replace(/-/g, ":").slice(0, 8);
    return `${date} ${time}`;
  }
  return raw.replace(/_/g, " ");
}

export function MemoryPanel({ open, onClose, onSyncNow, syncStatus, lastSynced }: MemoryPanelProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<PanelTab>("memory");

  const [memory, setMemory] = useState<MemoryFile>({ content: null, sha: null, configured: false });
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SelectedSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const loadMemory = useCallback(async () => {
    setMemoryLoading(true);
    try {
      const res = await fetch("/api/memory");
      const data = await res.json() as MemoryFile;
      setMemory(data);
      setMemoryDraft(data.content ?? "# AI Memory\n\nAdd notes here — or let the AI write them using [MEMORY: note].\n");
    } catch {
      toast({ title: "Failed to load memory", variant: "destructive" });
    } finally {
      setMemoryLoading(false);
    }
  }, [toast]);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/sessions");
      const data = await res.json() as SessionsResponse;
      setSessions(data.sessions ?? []);
    } catch {
      toast({ title: "Failed to load sessions", variant: "destructive" });
    } finally {
      setSessionsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) {
      loadMemory();
      loadSessions();
    }
  }, [open, loadMemory, loadSessions]);

  const saveMemory = async () => {
    setMemorySaving(true);
    try {
      const res = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: memoryDraft, sha: memory.sha }),
      });
      const data = await res.json() as MemoryFile;
      setMemory(data);
      toast({ title: "Memory saved to GitHub" });
    } catch {
      toast({ title: "Failed to save memory", variant: "destructive" });
    } finally {
      setMemorySaving(false);
    }
  };

  const loadSession = async (s: SessionEntry) => {
    setSessionLoading(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(s.name)}`);
      const data = await res.json() as { content: string; name: string };
      setSelectedSession({ name: s.name, content: data.content });
    } catch {
      toast({ title: "Failed to load session", variant: "destructive" });
    } finally {
      setSessionLoading(false);
    }
  };

  const handleSyncNow = async () => {
    await onSyncNow();
    await loadSessions();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-card border-card-border max-w-lg mx-4 max-h-[88dvh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="font-mono text-sm flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" /> AI Memory
            </DialogTitle>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Sync status bar */}
          <div className="flex items-center gap-2 mt-2">
            <div className={cn(
              "flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded border",
              syncStatus === "syncing" ? "text-yellow-400 border-yellow-400/30 bg-yellow-400/10" :
              syncStatus === "synced" ? "text-primary border-primary/30 bg-primary/10" :
              syncStatus === "error" ? "text-destructive border-destructive/30 bg-destructive/10" :
              "text-muted-foreground border-border bg-muted/30"
            )}>
              {syncStatus === "syncing"
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Syncing...</>
                : syncStatus === "synced"
                ? <><Clock className="w-3 h-3" /> {lastSynced ? `Synced ${lastSynced.toLocaleTimeString()}` : "Synced"}</>
                : <><Clock className="w-3 h-3" /> {lastSynced ? `Last sync: ${lastSynced.toLocaleTimeString()}` : "Not synced"}</>}
            </div>
            <div className="flex-1" />
            {!memory.configured && (
              <span className="text-[11px] text-muted-foreground">GitHub not configured — go to Settings</span>
            )}
            {memory.configured && (
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={handleSyncNow} disabled={syncStatus === "syncing"}>
                <CloudUpload className="w-3 h-3" /> Sync now
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          <button className={cn("flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5",
            tab === "memory" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            onClick={() => setTab("memory")}>
            <Brain className="w-3.5 h-3.5" /> Memory
          </button>
          <button className={cn("flex-1 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-1.5",
            tab === "sessions" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            onClick={() => { setTab("sessions"); setSelectedSession(null); }}>
            <FileText className="w-3.5 h-3.5" /> Sessions {sessions.length > 0 && <span className="text-xs opacity-60">({sessions.length})</span>}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
          {/* MEMORY TAB */}
          {tab === "memory" && (
            <div className="flex flex-col flex-1 overflow-hidden min-h-0">
              {!memory.configured ? (
                <div className="flex flex-col items-center justify-center flex-1 gap-3 px-4 text-center">
                  <Brain className="w-10 h-10 text-muted-foreground opacity-20" />
                  <p className="text-sm text-muted-foreground">Connect a GitHub repo in Settings to enable persistent AI memory.</p>
                </div>
              ) : memoryLoading ? (
                <div className="flex items-center justify-center flex-1 gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : (
                <>
                  <div className="px-3 pt-3 pb-1 shrink-0">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      This file is stored in your GitHub repo as <code className="text-primary">memory.md</code>. The AI reads it at the start of every conversation and can write to it using <code className="text-primary">[MEMORY: note]</code>.
                    </p>
                  </div>
                  <Textarea
                    value={memoryDraft}
                    onChange={e => setMemoryDraft(e.target.value)}
                    className="flex-1 font-mono text-xs resize-none border-0 rounded-none focus-visible:ring-0 bg-background m-2 mb-0 rounded-t"
                    placeholder="# AI Memory&#10;&#10;- Notes appear here..."
                  />
                  <div className="flex gap-2 p-3 shrink-0">
                    <Button variant="outline" size="sm" className="h-10 gap-1.5 text-xs" onClick={loadMemory} disabled={memoryLoading}>
                      <RefreshCw className={cn("w-3.5 h-3.5", memoryLoading && "animate-spin")} /> Reload
                    </Button>
                    <Button size="sm" className="flex-1 h-10 gap-1.5 text-xs" onClick={saveMemory} disabled={memorySaving || memoryDraft === (memory.content ?? "")}>
                      {memorySaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      {memorySaving ? "Saving..." : "Save to GitHub"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* SESSIONS TAB */}
          {tab === "sessions" && (
            <div className="flex flex-col flex-1 overflow-hidden min-h-0">
              {selectedSession ? (
                <>
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
                    <button onClick={() => setSelectedSession(null)} className="text-muted-foreground hover:text-foreground">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-mono text-muted-foreground truncate">{formatSessionName(selectedSession.name)}</span>
                  </div>
                  <pre className="flex-1 overflow-y-auto text-[11px] font-mono p-3 whitespace-pre-wrap leading-relaxed text-foreground/80">
                    {selectedSession.content}
                  </pre>
                </>
              ) : (
                <>
                  {!memory.configured ? (
                    <div className="flex flex-col items-center justify-center flex-1 gap-3 px-4 text-center">
                      <FileText className="w-10 h-10 text-muted-foreground opacity-20" />
                      <p className="text-sm text-muted-foreground">Connect a GitHub repo in Settings to save session transcripts.</p>
                    </div>
                  ) : sessionsLoading ? (
                    <div className="flex items-center justify-center flex-1 gap-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                    </div>
                  ) : sessions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center flex-1 gap-3 px-4 text-center">
                      <FileText className="w-10 h-10 text-muted-foreground opacity-20" />
                      <p className="text-sm text-muted-foreground">No sessions yet. Sessions are saved when you clear chat history or every 10 turns.</p>
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs h-9" onClick={handleSyncNow} disabled={syncStatus === "syncing"}>
                        <CloudUpload className="w-3.5 h-3.5" /> Save current session now
                      </Button>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto">
                      <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border/50 flex items-center justify-between">
                        <span>{sessions.length} session{sessions.length !== 1 ? "s" : ""}</span>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={loadSessions}>
                          <RefreshCw className="w-3 h-3" /> Refresh
                        </Button>
                      </div>
                      {sessions.map(s => (
                        <button
                          key={s.path}
                          className="w-full flex items-center justify-between px-3 py-3 border-b border-border/50 hover:bg-secondary/30 active:bg-secondary/50 transition-colors"
                          onClick={() => loadSession(s)}
                          disabled={sessionLoading}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                            <div className="text-left min-w-0">
                              <p className="text-xs font-mono text-foreground truncate">{formatSessionName(s.name)}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{s.name}</p>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
