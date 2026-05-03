import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  X, Save, Loader2, AlertTriangle, FileCode, FileText, File,
  ChevronRight, RotateCcw,
} from "lucide-react";

interface FileEditorProps {
  connectionId: string;
  file: { path: string; name: string } | null;
  onClose: () => void;
}

const TEXT_EXTENSIONS = new Set([
  "js", "ts", "tsx", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "c", "cpp", "cc", "h", "hpp",
  "css", "scss", "less", "html", "htm", "xml", "svg",
  "json", "yaml", "yml", "toml", "ini", "conf", "cfg", "env",
  "sh", "bash", "zsh", "fish", "ps1",
  "sql", "graphql", "gql",
  "md", "txt", "log", "csv", "tsv",
  "php", "kt", "swift", "dart", "lua", "r", "jl",
  "dockerfile", "makefile", "gitignore", "gitattributes",
  "nginx", "apache", "htaccess",
  "vue", "svelte", "astro",
  "lock", "sum",
]);

const LANG_LABELS: Record<string, string> = {
  js: "JavaScript", ts: "TypeScript", tsx: "TSX", jsx: "JSX",
  py: "Python", rb: "Ruby", go: "Go", rs: "Rust", java: "Java",
  c: "C", cpp: "C++", h: "C/C++ Header",
  css: "CSS", scss: "SCSS", html: "HTML", xml: "XML", svg: "SVG",
  json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
  sh: "Shell", bash: "Bash", sql: "SQL",
  md: "Markdown", txt: "Text", log: "Log",
  php: "PHP", kt: "Kotlin", swift: "Swift", vue: "Vue", svelte: "Svelte",
};

function getExt(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return name.toLowerCase();
  return name.slice(dot + 1).toLowerCase();
}

function isTextFile(name: string): boolean {
  const ext = getExt(name);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower === "makefile" || lower === "vagrantfile") return true;
  if (lower.startsWith(".") && !lower.includes(".")) return true; // .env, .gitignore etc
  return false;
}

function getLangLabel(name: string): string {
  const ext = getExt(name);
  return LANG_LABELS[ext] ?? ext.toUpperCase();
}

function countLines(text: string): number {
  return text.split("\n").length;
}

const MAX_EDITOR_BYTES = 2 * 1024 * 1024; // 2 MB

export function FileEditor({ connectionId, file, onClose }: FileEditorProps) {
  const { toast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [binaryFile, setBinaryFile] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const dirty = content !== original;

  const load = useCallback(async () => {
    if (!file) return;
    if (!isTextFile(file.name)) { setBinaryFile(true); return; }
    setBinaryFile(false); setLoadError(null); setTruncated(false);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/sftp/read?connectionId=${connectionId}&path=${encodeURIComponent(file.path)}&maxBytes=${MAX_EDITOR_BYTES}`
      );
      const data = await res.json() as { content?: string; truncated?: boolean; error?: string };
      if (data.error) { setLoadError(data.error); return; }
      const text = data.content ?? "";
      setContent(text); setOriginal(text); setTruncated(!!data.truncated);
      setTimeout(() => textareaRef.current?.focus(), 80);
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  }, [file, connectionId]);

  useEffect(() => { if (file) load(); }, [file, load]);

  const save = useCallback(async () => {
    if (!file || !dirty || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/sftp/write", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: Number(connectionId), path: file.path, content }),
      });
      const data = await res.json() as { success?: boolean; error?: string; bytes?: number };
      if (data.error) {
        toast({ title: "Save failed", description: data.error, variant: "destructive" });
      } else {
        setOriginal(content);
        toast({ title: "Saved", description: `${file.name} · ${(data.bytes ?? 0).toLocaleString()} bytes` });
      }
    } catch (err) {
      toast({ title: "Save failed", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [file, dirty, saving, content, connectionId, toast]);

  // Cmd/Ctrl+S shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  // Warn on close if dirty
  const handleClose = () => {
    if (dirty) {
      if (!window.confirm("You have unsaved changes. Close anyway?")) return;
    }
    onClose();
  };

  // Tab key inserts spaces instead of changing focus
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newContent = content.slice(0, start) + "  " + content.slice(end);
      setContent(newContent);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
    }
  };

  if (!file) return null;

  const ext = getExt(file.name);
  const lang = getLangLabel(file.name);
  const lines = countLines(content);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" data-testid="file-editor">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border bg-card shrink-0">
        <button
          className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition-colors shrink-0"
          onClick={handleClose}
          data-testid="button-editor-close"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs font-mono min-w-0 flex-1 overflow-hidden">
          <span className="text-muted-foreground truncate hidden sm:block">
            {file.path.split("/").slice(0, -1).join("/") || "/"}
          </span>
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 hidden sm:block" />
          <span className="text-foreground font-medium truncate">{file.name}</span>
          {dirty && <span className="text-yellow-400 text-[10px] shrink-0 ml-1">●</span>}
        </div>

        {/* Language badge */}
        {!binaryFile && !loadError && (
          <span className="hidden sm:inline text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">
            {lang}
          </span>
        )}

        {/* Revert */}
        {dirty && (
          <Button
            variant="ghost" size="sm"
            className="h-9 px-2.5 text-xs gap-1.5 shrink-0 text-muted-foreground"
            onClick={() => { if (window.confirm("Discard changes?")) { setContent(original); } }}
            title="Revert"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Revert</span>
          </Button>
        )}

        {/* Save */}
        {!binaryFile && !loadError && (
          <Button
            size="sm"
            className={cn(
              "h-9 px-3 text-xs gap-1.5 shrink-0 transition-all",
              dirty ? "bg-primary hover:bg-primary/90" : "bg-muted text-muted-foreground"
            )}
            onClick={save}
            disabled={!dirty || saving || loading || truncated}
            data-testid="button-editor-save"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? "Saving..." : "Save"}
          </Button>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
        {loading ? (
          <div className="flex items-center justify-center flex-1 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading {file.name}...</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 text-center">
            <AlertTriangle className="w-10 h-10 text-destructive opacity-50" />
            <p className="text-sm font-medium text-foreground">Failed to load file</p>
            <p className="text-xs text-muted-foreground font-mono">{loadError}</p>
            <Button variant="outline" className="h-10 text-sm gap-1.5" onClick={load}>
              <RotateCcw className="w-4 h-4" /> Retry
            </Button>
          </div>
        ) : binaryFile ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 px-6 text-center">
            <File className="w-10 h-10 text-muted-foreground opacity-30" />
            <p className="text-sm font-medium text-foreground">Binary file</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono text-primary">{file.name}</span> cannot be edited as text.
            </p>
            <Button variant="outline" className="h-10 text-sm gap-1.5"
              onClick={() => {
                const url = `/api/sftp/download?connectionId=${connectionId}&path=${encodeURIComponent(file.path)}`;
                const a = document.createElement("a"); a.href = url; a.download = file.name;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
              }}>
              Download instead
            </Button>
          </div>
        ) : (
          <>
            {truncated && (
              <div className="flex items-center gap-2 px-3 py-2 bg-yellow-400/10 border-b border-yellow-400/20 shrink-0">
                <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
                <p className="text-xs text-yellow-400">
                  File exceeds 2 MB — showing partial content. Saving is disabled to prevent data loss.
                </p>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              data-testid="editor-textarea"
              className={cn(
                "flex-1 w-full resize-none bg-background text-foreground font-mono outline-none p-4",
                "text-[13px] leading-[1.6] min-h-0",
                "selection:bg-primary/30",
              )}
              style={{ tabSize: ["py", "html", "xml", "yaml", "yml"].includes(ext) ? 4 : 2 }}
            />
          </>
        )}
      </div>

      {/* Status bar */}
      {!loading && !loadError && !binaryFile && (
        <div className="shrink-0 px-3 py-1.5 border-t border-border bg-card flex items-center gap-4 text-[11px] font-mono text-muted-foreground">
          <span>{lines.toLocaleString()} lines</span>
          <span>{content.length.toLocaleString()} chars</span>
          <span className="flex-1" />
          {dirty
            ? <span className="text-yellow-400">Unsaved changes — Ctrl+S / ⌘S to save</span>
            : <span className="text-primary/60">Saved</span>}
        </div>
      )}
    </div>
  );
}
