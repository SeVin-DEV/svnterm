import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { aiSettingsTable, chatMessagesTable } from "@workspace/db";
import {
  readGitHubFile,
  writeGitHubFile,
  listGitHubDir,
  syncSessionToGitHub,
  verifyGitHubAccess,
} from "../services/github";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function getSettings() {
  const [s] = await db.select().from(aiSettingsTable).limit(1);
  return s ?? null;
}

function requireGitHub(settings: { githubToken?: string | null; githubRepo?: string | null } | null): { token: string; repo: string } | null {
  if (!settings?.githubToken || !settings?.githubRepo) return null;
  return { token: settings.githubToken, repo: settings.githubRepo };
}

/* ── GET /api/memory ── */
router.get("/memory", async (_req, res) => {
  const settings = await getSettings();
  const gh = requireGitHub(settings);
  if (!gh) {
    res.json({ content: null, sha: null, configured: false });
    return;
  }
  try {
    const file = await readGitHubFile(gh.token, gh.repo, "memory.md");
    res.json({ content: file?.content ?? null, sha: file?.sha ?? null, configured: true });
  } catch (err) {
    logger.error({ err }, "Failed to read memory file");
    res.status(502).json({ error: "Failed to read memory from GitHub" });
  }
});

/* ── PUT /api/memory ── */
router.put("/memory", async (req, res) => {
  const settings = await getSettings();
  const gh = requireGitHub(settings);
  if (!gh) { res.status(400).json({ error: "GitHub not configured" }); return; }
  const body = req.body as { content?: unknown; sha?: unknown };
  if (typeof body.content !== "string") { res.status(400).json({ error: "content is required" }); return; }
  const content = body.content as string;
  const sha = typeof body.sha === "string" ? body.sha : undefined;
  try {
    await writeGitHubFile(gh.token, gh.repo, "memory.md", content, "Memory: manual update", sha);
    const updated = await readGitHubFile(gh.token, gh.repo, "memory.md");
    res.json({ content: updated?.content ?? content, sha: updated?.sha ?? null, configured: true });
  } catch (err) {
    logger.error({ err }, "Failed to write memory file");
    res.status(502).json({ error: "Failed to write memory to GitHub" });
  }
});

/* ── GET /api/sessions ── */
router.get("/sessions", async (_req, res) => {
  const settings = await getSettings();
  const gh = requireGitHub(settings);
  if (!gh) { res.json({ sessions: [], configured: false }); return; }
  try {
    const entries = await listGitHubDir(gh.token, gh.repo, "sessions");
    const sessions = entries
      .filter(e => e.type === "file" && e.name.endsWith(".md"))
      .sort((a, b) => b.name.localeCompare(a.name))
      .map(e => ({ name: e.name, path: e.path, sha: e.sha }));
    res.json({ sessions, configured: true });
  } catch (err) {
    logger.error({ err }, "Failed to list sessions");
    res.status(502).json({ error: "Failed to list sessions from GitHub" });
  }
});

/* ── GET /api/sessions/:name ── */
router.get("/sessions/:name", async (req, res) => {
  const settings = await getSettings();
  const gh = requireGitHub(settings);
  if (!gh) { res.status(400).json({ error: "GitHub not configured" }); return; }
  const name = req.params.name;
  if (!name.endsWith(".md") || name.includes("/") || name.includes("..")) {
    res.status(400).json({ error: "Invalid session name" }); return;
  }
  try {
    const file = await readGitHubFile(gh.token, gh.repo, `sessions/${name}`);
    if (!file) { res.status(404).json({ error: "Session not found" }); return; }
    res.json({ content: file.content, name: file.name });
  } catch (err) {
    logger.error({ err }, "Failed to read session");
    res.status(502).json({ error: "Failed to read session from GitHub" });
  }
});

/* ── POST /api/memory/sync ── */
router.post("/memory/sync", async (_req, res) => {
  const settings = await getSettings();
  const gh = requireGitHub(settings);
  if (!gh) { res.status(400).json({ error: "GitHub not configured" }); return; }
  try {
    const messages = await db
      .select()
      .from(chatMessagesTable)
      .orderBy(chatMessagesTable.createdAt);
    if (!messages.length) {
      res.json({ synced: false, reason: "No messages to sync" }); return;
    }
    const sessionPath = await syncSessionToGitHub(gh.token, gh.repo, messages);
    res.json({ synced: true, path: sessionPath });
  } catch (err) {
    logger.error({ err }, "Failed to sync session");
    res.status(502).json({ error: "Failed to sync session to GitHub" });
  }
});

/* ── POST /api/github/verify ── */
router.post("/github/verify", async (req, res) => {
  const body = req.body as { token?: unknown; repo?: unknown };
  if (typeof body.token !== "string" || typeof body.repo !== "string") {
    res.status(400).json({ error: "token and repo are required" }); return;
  }
  const result = await verifyGitHubAccess(body.token, body.repo);
  res.json(result);
});

export default router;
