import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useListSshConnections } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Folder, File, FileText, FileCode, FileImage, FileVideo,
  FileArchive, ChevronRight, Home, Upload, FolderPlus, Download,
  Trash2, Pencil, Bot, RefreshCw, Loader2, ArrowLeft, X, SquarePen,
} from "lucide-react";
import { FileEditor } from "@/components/file-editor";

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modified: number;
  permissions: string;
}

interface ListResponse {
  path: string;
  entries: FileEntry[];
}

const BASE = "/api";

function fileIcon(entry: FileEntry) {
  if (entry.isDirectory) return Folder;
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (["png","jpg","jpeg","gif","svg","webp","ico","bmp"].includes(ext)) return FileImage;
  if (["mp4","mov","avi","mkv","webm"].includes(ext)) return FileVideo;
  if (["zip","tar","gz","bz2","7z","rar","xz"].includes(ext)) return FileArchive;
  if (["js","ts","tsx","jsx","py","rb","go","rs","java","c","cpp","h","css","html","json","yaml","yml","toml","sh","bash"].includes(ext)) return FileCode;
  if (["txt","md","log","csv","xml","env","conf","cfg","ini"].includes(ext)) return FileText;
  return File;
}

function formatSize(bytes: number, isDir: boolean): string {
  if (isDir) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
}

function formatDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function parentPath(p: string): string {
  if (p === "/" || !p) return "/";
  const parts = p.replace(/\/$/, "").split("/");
  parts.pop();
  return parts.join("/") || "/";
}

function breadcrumbs(p: string): Array<{ label: string; path: string }> {
  if (p === "/") return [{ label: "/", path: "/" }];
  const parts = p.replace(/\/$/, "").split("/").filter(Boolean);
  const crumbs = [{ label: "/", path: "/" }];
  let cur = "";
  for (const part of parts) {
    cur += "/" + part;
    crumbs.push({ label: part, path: cur });
  }
  return crumbs;
}

export default function FilesPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const connections = useListSshConnections();

  const [connId, setConnId] = useState<string>("");
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<FileEntry[]>([]);

  const [editorFile, setEditorFile] = useState<{ path: string; name: string } | null>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<FileEntry | null>(null);
  const [shareContent, setShareContent] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareTruncated, setShareTruncated] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDir = useCallback(async (id: string, path: string) => {
    if (!id) return;
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await fetch(`${BASE}/sftp/list?connectionId=${id}&path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const err = await res.json() as { error: string };
        toast({ title: "Error listing directory", description: err.error, variant: "destructive" });
        return;
      }
      const data = await res.json() as ListResponse;
      setEntries(data.entries);
      setCurrentPath(data.path);
    } catch (err) {
      toast({ title: "Network error", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (connId) loadDir(connId, "/");
  }, [connId, loadDir]);

  const handleNavigate = (path: string) => loadDir(connId, path);

  const handleSelect = (path: string, multi = false) => {
    setSelected(prev => {
      const next = multi ? new Set(prev) : new Set<string>();
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleRowClick = (entry: FileEntry, e: React.MouseEvent) => {
    if (entry.isDirectory) handleNavigate(entry.path);
    else handleSelect(entry.path, e.metaKey || e.ctrlKey);
  };

  const handleDownload = (entry: FileEntry) => {
    const url = `${BASE}/sftp/download?connectionId=${connId}&path=${encodeURIComponent(entry.path)}`;
    const a = document.createElement("a");
    a.href = url; a.download = entry.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleUploadFiles = useCallback(async (files: FileList) => {
    if (!connId || !files.length) return;
    setUploading(true);
    let errors = 0;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("connectionId", connId);
      fd.append("path", currentPath.replace(/\/$/, "") + "/" + file.name);
      fd.append("file", file);
      try {
        const res = await fetch(`${BASE}/sftp/upload`, { method: "POST", body: fd });
        if (!res.ok) errors++;
      } catch { errors++; }
    }
    setUploading(false);
    if (errors) toast({ title: `${errors} file(s) failed`, variant: "destructive" });
    else toast({ title: `${files.length} file(s) uploaded` });
    loadDir(connId, currentPath);
  }, [connId, currentPath, loadDir, toast]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) handleUploadFiles(e.dataTransfer.files);
  };

  const confirmDelete = (targets: FileEntry[]) => { setDeleteTargets(targets); setDeleteOpen(true); };
  const doDelete = async () => {
    setDeleteOpen(false);
    let errors = 0;
    for (const t of deleteTargets) {
      try {
        const res = await fetch(`${BASE}/sftp/delete?connectionId=${connId}&path=${encodeURIComponent(t.path)}&isDir=${t.isDirectory}`, { method: "DELETE" });
        if (!res.ok) errors++;
      } catch { errors++; }
    }
    if (errors) toast({ title: `${errors} item(s) failed`, variant: "destructive" });
    else toast({ title: `Deleted ${deleteTargets.length} item(s)` });
    setSelected(new Set()); loadDir(connId, currentPath);
  };

  const openRename = (entry: FileEntry) => { setRenameTarget(entry); setRenameTo(entry.name); setRenameOpen(true); };
  const doRename = async () => {
    if (!renameTarget || !renameTo.trim()) return;
    setRenameOpen(false);
    const newPath = parentPath(renameTarget.path) + "/" + renameTo.trim();
    const res = await fetch(`${BASE}/sftp/rename`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: Number(connId), oldPath: renameTarget.path, newPath }),
    });
    if (!res.ok) { const err = await res.json() as { error: string }; toast({ title: "Rename failed", description: err.error, variant: "destructive" }); }
    else toast({ title: "Renamed" });
    loadDir(connId, currentPath);
  };

  const doMkdir = async () => {
    if (!mkdirName.trim()) return;
    setMkdirOpen(false);
    const newPath = currentPath.replace(/\/$/, "") + "/" + mkdirName.trim();
    const res = await fetch(`${BASE}/sftp/mkdir`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: Number(connId), path: newPath }),
    });
    if (!res.ok) { const err = await res.json() as { error: string }; toast({ title: "Failed", description: err.error, variant: "destructive" }); }
    else toast({ title: "Folder created" });
    setMkdirName(""); loadDir(connId, currentPath);
  };

  const openShare = async (entry: FileEntry) => {
    setShareTarget(entry); setShareContent(""); setShareTruncated(false); setShareOpen(true); setShareLoading(true);
    try {
      const res = await fetch(`${BASE}/sftp/read?connectionId=${connId}&path=${encodeURIComponent(entry.path)}`);
      const data = await res.json() as { content: string; truncated: boolean; error?: string };
      if (data.error) { toast({ title: "Cannot read file", description: data.error, variant: "destructive" }); setShareOpen(false); return; }
      setShareContent(data.content); setShareTruncated(data.truncated);
    } catch (err) { toast({ title: "Error", description: String(err), variant: "destructive" }); setShareOpen(false); }
    finally { setShareLoading(false); }
  };

  const doShareWithAI = async () => {
    if (!shareTarget || !shareContent) return;
    const message = `Here is the content of \`${shareTarget.path}\`:\n\`\`\`\n${shareContent}\n\`\`\`\n\nPlease review this file and tell me anything notable.`;
    try {
      await fetch(`${BASE}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      setShareOpen(false); navigate("/"); toast({ title: "File shared with AI" });
    } catch (err) { toast({ title: "Failed", description: String(err), variant: "destructive" }); }
  };

  const selectedEntries = entries.filter(e => selected.has(e.path));

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="files-page">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border bg-card shrink-0">
        <span className="text-sm font-semibold text-foreground">Files</span>
        <div className="flex-1" />
        <Select value={connId} onValueChange={setConnId}>
          <SelectTrigger className="h-9 text-xs w-40 border-border" data-testid="select-sftp-connection">
            <SelectValue placeholder="Select server..." />
          </SelectTrigger>
          <SelectContent>
            {connections.data?.map(c => (
              <SelectItem key={c.id} value={String(c.id)} className="text-xs">{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!connId ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center gap-3 px-4">
          <Folder className="w-14 h-14 text-muted-foreground opacity-20" />
          <p className="text-sm text-muted-foreground">Select a server above to browse files.</p>
        </div>
      ) : (
        <div
          className={cn("flex flex-col flex-1 overflow-hidden relative", dragging && "ring-2 ring-inset ring-primary")}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          {dragging && (
            <div className="absolute inset-0 z-20 bg-primary/10 flex items-center justify-center pointer-events-none">
              <div className="text-primary font-mono text-sm flex items-center gap-2">
                <Upload className="w-5 h-5" /> Drop to upload here
              </div>
            </div>
          )}

          {/* Breadcrumb + nav row */}
          <div className="flex items-center gap-1.5 px-2 py-2 border-b border-border bg-card shrink-0 overflow-x-auto">
            <button
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground disabled:opacity-30 transition-colors"
              onClick={() => handleNavigate(parentPath(currentPath))}
              disabled={currentPath === "/"}
              title="Up"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1 text-xs font-mono flex-1 min-w-0 overflow-x-auto">
              {breadcrumbs(currentPath).map((crumb, i, arr) => (
                <span key={crumb.path} className="flex items-center gap-1 shrink-0">
                  {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                  <button
                    className={cn("px-1 py-0.5 rounded hover:text-primary transition-colors", i === arr.length - 1 ? "text-foreground font-medium" : "text-muted-foreground")}
                    onClick={() => handleNavigate(crumb.path)}
                  >
                    {i === 0 ? <Home className="w-3.5 h-3.5 inline" /> : crumb.label}
                  </button>
                </span>
              ))}
            </div>
            <button
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition-colors"
              onClick={() => loadDir(connId, currentPath)}
              title="Refresh"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
          </div>

          {/* Action toolbar — horizontal scroll on mobile */}
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-card shrink-0 overflow-x-auto">
            {selectedEntries.length > 0 && (
              <>
                {selectedEntries.length === 1 && !selectedEntries[0]!.isDirectory && (
                  <>
                    <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5 shrink-0 border-border" onClick={() => setEditorFile({ path: selectedEntries[0]!.path, name: selectedEntries[0]!.name })}>
                      <SquarePen className="w-3.5 h-3.5" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5 shrink-0 border-border" onClick={() => handleDownload(selectedEntries[0]!)}>
                      <Download className="w-3.5 h-3.5" /> Download
                    </Button>
                    <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5 shrink-0 border-border" onClick={() => openShare(selectedEntries[0]!)}>
                      <Bot className="w-3.5 h-3.5" /> AI
                    </Button>
                  </>
                )}
                {selectedEntries.length === 1 && (
                  <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5 shrink-0 border-border" onClick={() => openRename(selectedEntries[0]!)}>
                    <Pencil className="w-3.5 h-3.5" /> Rename
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5 shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10" onClick={() => confirmDelete(selectedEntries)}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete ({selectedEntries.length})
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setSelected(new Set())}>
                  <X className="w-4 h-4" />
                </Button>
                <div className="shrink-0 w-px h-6 bg-border mx-0.5" />
              </>
            )}
            <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5 shrink-0 border-border" onClick={() => { setMkdirName(""); setMkdirOpen(true); }}>
              <FolderPlus className="w-3.5 h-3.5" /> New Folder
            </Button>
            <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5 shrink-0 border-border" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
            </Button>
          </div>

          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={e => e.target.files && handleUploadFiles(e.target.files)} />

          {/* File list — scrollable */}
          <div className="flex-1 overflow-y-auto" data-testid="file-list">
            {loading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-sm">Loading...</span>
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Folder className="w-12 h-12 opacity-20" />
                <span className="text-sm">Empty directory</span>
                <span className="text-xs opacity-60">Drop files here or tap Upload</span>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {entries.map((entry) => {
                  const Icon = fileIcon(entry);
                  const isSelected = selected.has(entry.path);
                  return (
                    <div
                      key={entry.path}
                      className={cn(
                        "flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors active:bg-secondary/50",
                        isSelected ? "bg-primary/10" : "hover:bg-secondary/30"
                      )}
                      onClick={e => handleRowClick(entry, e)}
                      data-testid={`file-row-${entry.name}`}
                    >
                      {/* Checkbox */}
                      <div className="shrink-0" onClick={e => { e.stopPropagation(); handleSelect(entry.path, true); }}>
                        <div className={cn(
                          "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                          isSelected ? "bg-primary border-primary" : "border-border"
                        )}>
                          {isSelected && <span className="text-primary-foreground text-[10px] font-bold">✓</span>}
                        </div>
                      </div>

                      {/* Icon + Name */}
                      <Icon className={cn("w-5 h-5 shrink-0", entry.isDirectory ? "text-yellow-400" : "text-muted-foreground")} />
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-sm font-mono truncate", entry.isDirectory ? "text-yellow-300 font-medium" : "text-foreground")}>
                          {entry.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                          {formatSize(entry.size, entry.isDirectory)}
                          {entry.modified ? ` · ${formatDate(entry.modified)}` : ""}
                          {entry.isSymlink ? " · symlink" : ""}
                        </p>
                      </div>

                      {/* Row actions */}
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        {!entry.isDirectory && (
                          <>
                            <button className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition-colors" onClick={() => setEditorFile({ path: entry.path, name: entry.name })} title="Edit">
                              <SquarePen className="w-4 h-4" />
                            </button>
                            <button className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition-colors" onClick={() => handleDownload(entry)} title="Download">
                              <Download className="w-4 h-4" />
                            </button>
                            <button className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition-colors" onClick={() => openShare(entry)} title="Share with AI">
                              <Bot className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition-colors" onClick={() => openRename(entry)} title="Rename">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-destructive/10 text-destructive/70 transition-colors" onClick={() => confirmDelete([entry])} title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className="shrink-0 px-3 py-1.5 border-t border-border bg-card text-[11px] text-muted-foreground font-mono flex items-center gap-3">
            <span>{entries.length} items</span>
            {selected.size > 0 && <span className="text-primary">{selected.size} selected</span>}
            <span className="flex-1 text-right truncate opacity-60">{currentPath}</span>
          </div>
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="bg-card border-card-border max-w-sm mx-4">
          <DialogHeader><DialogTitle className="font-mono text-sm">Rename</DialogTitle></DialogHeader>
          <Input value={renameTo} onChange={e => setRenameTo(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") doRename(); }}
            className="font-mono h-11 text-sm" autoFocus data-testid="input-rename" />
          <DialogFooter className="gap-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button className="flex-1 h-11" onClick={doRename} disabled={!renameTo.trim()}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New folder dialog */}
      <Dialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
        <DialogContent className="bg-card border-card-border max-w-sm mx-4">
          <DialogHeader><DialogTitle className="font-mono text-sm">New Folder</DialogTitle></DialogHeader>
          <Input value={mkdirName} onChange={e => setMkdirName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") doMkdir(); }}
            placeholder="Folder name" className="font-mono h-11 text-sm" autoFocus data-testid="input-mkdir" />
          <DialogFooter className="gap-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setMkdirOpen(false)}>Cancel</Button>
            <Button className="flex-1 h-11" onClick={doMkdir} disabled={!mkdirName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-card border-card-border max-w-sm mx-4">
          <DialogHeader><DialogTitle className="font-mono text-sm">Delete {deleteTargets.length > 1 ? `${deleteTargets.length} items` : deleteTargets[0]?.name}?</DialogTitle></DialogHeader>
          {deleteTargets.some(t => t.isDirectory) && (
            <p className="text-xs text-destructive">⚠ Directories must be empty to delete.</p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" className="flex-1 h-11" onClick={doDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share with AI */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="bg-card border-card-border max-w-lg mx-4 max-h-[85dvh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" /> {shareTarget?.name}
            </DialogTitle>
          </DialogHeader>
          {shareLoading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" /> Reading file...
            </div>
          ) : (
            <div className="flex flex-col gap-3 flex-1 overflow-hidden min-h-0">
              {shareTruncated && <p className="text-xs text-yellow-400 bg-yellow-400/10 rounded px-3 py-2 shrink-0">Showing first 100 KB only</p>}
              <pre className="text-[11px] font-mono bg-background border border-border rounded p-3 overflow-y-auto flex-1 whitespace-pre-wrap break-all">
                {shareContent || "(empty)"}
              </pre>
              <p className="text-xs text-muted-foreground shrink-0">Sends file content to AI and opens the terminal view.</p>
            </div>
          )}
          <DialogFooter className="gap-2 shrink-0">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setShareOpen(false)}>Cancel</Button>
            <Button className="flex-1 h-11 gap-1.5" onClick={doShareWithAI} disabled={shareLoading || !shareContent}>
              <Bot className="w-4 h-4" /> Send to AI
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* In-browser file editor — full-screen overlay */}
      {editorFile && (
        <FileEditor
          connectionId={connId}
          file={editorFile}
          onClose={() => setEditorFile(null)}
        />
      )}
    </div>
  );
}
