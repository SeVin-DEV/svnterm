import { logger } from "../lib/logger";

const GITHUB_API = "https://api.github.com";

export interface GitHubFile {
  content: string;
  sha: string;
  path: string;
  name: string;
}

export interface GitHubDirEntry {
  name: string;
  path: string;
  sha: string;
  type: "file" | "dir";
}

function authHeaders(token: string) {
  return {
    "Authorization": `token ${token}`,
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "TerminalAI-App",
  };
}

function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) throw new Error(`Invalid repo format: "${repo}". Use "owner/repo".`);
  return { owner, repo: repoName };
}

export async function readGitHubFile(token: string, repoStr: string, path: string): Promise<GitHubFile | null> {
  const { owner, repo } = parseRepo(repoStr);
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.text();
    logger.error({ status: res.status, err, path }, "GitHub readFile error");
    throw new Error(`GitHub API ${res.status}: ${err}`);
  }
  const data = await res.json() as { content: string; sha: string; path: string; name: string; encoding: string };
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { content, sha: data.sha, path: data.path, name: data.name };
}

export async function writeGitHubFile(
  token: string,
  repoStr: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<void> {
  const { owner, repo } = parseRepo(repoStr);
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    logger.error({ status: res.status, err, path }, "GitHub writeFile error");
    throw new Error(`GitHub API ${res.status}: ${err}`);
  }
}

export async function listGitHubDir(token: string, repoStr: string, path: string): Promise<GitHubDirEntry[]> {
  const { owner, repo } = parseRepo(repoStr);
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return [];
  if (!res.ok) {
    const err = await res.text();
    logger.error({ status: res.status, err, path }, "GitHub listDir error");
    return [];
  }
  const data = await res.json() as Array<{ name: string; path: string; sha: string; type: string }>;
  if (!Array.isArray(data)) return [];
  return data.map(e => ({
    name: e.name,
    path: e.path,
    sha: e.sha,
    type: (e.type === "dir" ? "dir" : "file") as "file" | "dir",
  }));
}

export async function appendToMemory(token: string, repoStr: string, note: string): Promise<void> {
  const MEMORY_PATH = "memory.md";
  const now = new Date().toISOString().split("T")[0];
  const existing = await readGitHubFile(token, repoStr, MEMORY_PATH);
  let content = existing?.content ?? "# AI Memory\n\nPersistent notes across sessions.\n\n## Notes\n\n";
  content = content.trimEnd() + `\n- [${now}] ${note}\n`;
  await writeGitHubFile(token, repoStr, MEMORY_PATH, content, `Memory: add note`, existing?.sha);
}

export async function syncSessionToGitHub(
  token: string,
  repoStr: string,
  messages: Array<{ role: string; content: string; command?: string | null; createdAt: Date }>,
): Promise<string | null> {
  if (!messages.length) return null;
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const sessionPath = `sessions/${dateStr}.md`;

  const lines: string[] = [
    `# Session: ${now.toLocaleString()}`,
    "",
    `**Messages:** ${messages.length}`,
    "",
    "## Transcript",
    "",
  ];

  for (const msg of messages) {
    const role = msg.role === "user" ? "**User**" : "**AI**";
    lines.push(`${role}: ${msg.content}`);
    if (msg.command) lines.push(`\`\`\`\n${msg.command}\n\`\`\``);
    lines.push("");
  }

  const content = lines.join("\n");
  await writeGitHubFile(token, repoStr, sessionPath, content, `Session: ${now.toLocaleString()}`);
  return sessionPath;
}

export async function verifyGitHubAccess(token: string, repoStr: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { owner, repo } = parseRepo(repoStr);
    const url = `${GITHUB_API}/repos/${owner}/${repo}`;
    const res = await fetch(url, { headers: authHeaders(token) });
    if (res.status === 200) return { ok: true };
    if (res.status === 401) return { ok: false, error: "Invalid token (401 Unauthorized)" };
    if (res.status === 403) return { ok: false, error: "No access to this repo (403 Forbidden)" };
    if (res.status === 404) return { ok: false, error: "Repo not found (404). Check owner/repo format." };
    return { ok: false, error: `GitHub API returned ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
