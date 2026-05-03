import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { aiSettingsTable, chatMessagesTable } from "@workspace/db";
import { SendChatMessageBody } from "@workspace/api-zod";
import { desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  readGitHubFile,
  appendToMemory,
  syncSessionToGitHub,
  listGitHubDir,
} from "../services/github";

const router: IRouter = Router();

const MEMORY_INJECT_TURNS = 5; // sync to GitHub every N assistant turns

/** Strip and collect [MEMORY: ...] tags from AI response text */
function extractMemoryTags(text: string): { cleaned: string; notes: string[] } {
  const notes: string[] = [];
  const cleaned = text.replace(/\[MEMORY:\s*([^\]]+)\]/gi, (_match, note: string) => {
    notes.push(note.trim());
    return "";
  }).trim();
  return { cleaned, notes };
}

/** Build the context preamble injected before the user system prompt */
async function buildMemoryContext(
  githubToken: string,
  githubRepo: string,
): Promise<string> {
  const parts: string[] = [];

  // 1. Memory file
  try {
    const memFile = await readGitHubFile(githubToken, githubRepo, "memory.md");
    if (memFile?.content?.trim()) {
      parts.push(`=== PERSISTENT MEMORY ===\n${memFile.content.trim()}\n=== END MEMORY ===`);
    }
  } catch {
    // Not fatal
  }

  // 2. Two most recent sessions
  try {
    const entries = await listGitHubDir(githubToken, githubRepo, "sessions");
    const recentFiles = entries
      .filter(e => e.type === "file" && e.name.endsWith(".md"))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 2);

    if (recentFiles.length) {
      const sessionParts: string[] = [];
      for (const f of recentFiles) {
        try {
          const sessionFile = await readGitHubFile(githubToken, githubRepo, `sessions/${f.name}`);
          if (sessionFile?.content) {
            sessionParts.push(`[${f.name.replace(".md", "")}]\n${sessionFile.content.slice(0, 700)}`);
          }
        } catch { /* skip */ }
      }
      if (sessionParts.length) {
        parts.push(`=== RECENT SESSIONS ===\n${sessionParts.join("\n\n---\n\n")}\n=== END SESSIONS ===`);
      }
    }
  } catch {
    // Not fatal
  }

  return parts.join("\n\n");
}

router.get("/chat/history", async (_req, res) => {
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(chatMessagesTable.createdAt)
    .limit(100);
  res.json(messages);
});

router.delete("/chat/history", async (_req, res) => {
  const settings = await db.select().from(aiSettingsTable).limit(1);
  const s = settings[0];

  // Save current session to GitHub before clearing
  if (s?.githubToken && s?.githubRepo) {
    try {
      const messages = await db.select().from(chatMessagesTable).orderBy(chatMessagesTable.createdAt);
      if (messages.length > 0) {
        await syncSessionToGitHub(s.githubToken, s.githubRepo, messages);
      }
    } catch (err) {
      logger.error({ err }, "Failed to sync session before clear");
    }
  }

  await db.delete(chatMessagesTable);
  res.status(204).send();
});

router.post("/chat", async (req, res) => {
  const body = SendChatMessageBody.parse(req.body);

  const [settings] = await db.select().from(aiSettingsTable).limit(1);

  if (!settings?.apiKey) {
    res.status(400).json({ error: "AI API key not configured. Go to Settings to add your API key." });
    return;
  }

  // Store user message
  await db.insert(chatMessagesTable).values({
    role: "user",
    content: body.message,
    terminalContext: body.terminalContext,
  });

  // Handle forceMemory: immediately save user note to memory
  if (body.forceMemory && settings.githubToken && settings.githubRepo) {
    try {
      await appendToMemory(settings.githubToken, settings.githubRepo, `[User note] ${body.message}`);
    } catch (err) {
      logger.error({ err }, "Failed to save forced memory note");
    }
  }

  const recentHistory = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(20);
  const orderedHistory = recentHistory.reverse();

  const isAgentMode = body.agentMode === true;

  // Build memory context prefix (if GitHub is configured)
  let memoryContext = "";
  if (settings.githubToken && settings.githubRepo) {
    try {
      memoryContext = await buildMemoryContext(settings.githubToken, settings.githubRepo);
    } catch (err) {
      logger.warn({ err }, "Failed to build memory context");
    }
  }

  // Build system prompt
  const defaultBasePrompt = `You are an expert SSH terminal and coding assistant embedded directly inside a terminal application. You have DIRECT ACCESS to run commands on the connected SSH server — never claim otherwise. You can see terminal output, suggest commands, run them with one click, and in agent mode execute tasks autonomously. Always be direct and helpful.

When the user asks you to run a command, respond with JSON: {"message": "I'll do X.", "command": "the-command"}
Otherwise respond in plain text.`;

  const basePrompt = settings.systemPrompt?.trim() || defaultBasePrompt;

  const memoryInstructions = `

You have a PERSISTENT MEMORY SYSTEM synced to GitHub. To save something to memory, include [MEMORY: your note] anywhere in your response — it will be stripped from what the user sees but saved to your memory file for future sessions. Use this when the user says "remember", "don't forget", "make a note", or when you discover something important about the project or preferences.`;

  let systemPrompt: string;

  if (isAgentMode) {
    const agentBase = settings.systemPrompt
      ? `${settings.systemPrompt}\n\nYou are running in AGENT MODE.`
      : "You are running in AGENT MODE.";

    systemPrompt = [
      memoryContext,
      agentBase,
      `
You are an autonomous SSH terminal agent. The user has assigned you a task to complete autonomously.

CRITICAL: You MUST respond with ONLY a valid JSON object — no markdown, no code fences, no extra text.

JSON format:
{"message": "explanation of what you're doing or what you found", "command": "the-shell-command-to-run", "done": false}

When the task is complete or you cannot proceed further:
{"message": "Task complete. Summary of what was done.", "done": true}

Rules:
- Always include "message" (human-readable explanation)
- Include "command" when you need to run something (omit when done)
- Set "done": true ONLY when the task is fully complete or you are stuck
- Run one command at a time — wait for output before deciding next step
- The terminalContext field shows you the latest terminal output from the previous command
- Be precise and efficient — use targeted commands
- If a command fails, adapt and try a different approach
- Do NOT ask the user questions — make decisions autonomously
- You may include [MEMORY: ...] in the "message" field to save notes
- Current task: ${body.agentTask ?? "the assigned task"}
- Current step: ${body.agentStep ?? 1}
`,
    ].filter(Boolean).join("\n\n");
  } else {
    systemPrompt = [
      memoryContext,
      basePrompt + memoryInstructions,
    ].filter(Boolean).join("\n\n");
  }

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of orderedHistory.slice(0, -1)) {
    if (msg.terminalContext && msg.role === "user") {
      messages.push({
        role: "user",
        content: `${msg.content}\n\n[Terminal output]:\n${msg.terminalContext}`,
      });
    } else {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  const userContent = body.terminalContext
    ? `${body.message}\n\n[Terminal output]:\n${body.terminalContext}`
    : body.message;

  messages.push({ role: "user", content: userContent });

  const baseUrl = settings.endpointUrl.replace(/\/$/, "");
  const apiUrl = `${baseUrl}/chat/completions`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.modelName,
        messages,
        max_tokens: 1500,
        ...(isAgentMode ? { temperature: 0.2 } : {}),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ status: response.status, errText }, "AI API error");
      res.status(502).json({ error: `AI API returned ${response.status}: ${errText}` });
      return;
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const rawContent = data.choices[0]?.message?.content ?? "";

    let assistantMessage = rawContent;
    let command: string | undefined;
    let done: boolean | undefined;

    try {
      const stripped = rawContent.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { message?: string; command?: string; done?: boolean };
        if (parsed.message) assistantMessage = parsed.message;
        if (parsed.command) command = parsed.command;
        if (typeof parsed.done === "boolean") done = parsed.done;
      }
    } catch {
      // Not JSON, use raw content
    }

    // Extract [MEMORY: ...] tags and save them
    let memorySaved = false;
    const { cleaned, notes } = extractMemoryTags(assistantMessage);
    if (notes.length > 0) {
      assistantMessage = cleaned;
      if (settings.githubToken && settings.githubRepo) {
        for (const note of notes) {
          try {
            await appendToMemory(settings.githubToken, settings.githubRepo, note);
            memorySaved = true;
          } catch (err) {
            logger.error({ err }, "Failed to save memory note");
          }
        }
      }
    }

    // Also check for "remember" trigger from user message
    const rememberTrigger = /^(remember|don'?t forget|make a note|note that|please remember)\b/i.test(body.message.trim());
    if (rememberTrigger && !body.forceMemory && settings.githubToken && settings.githubRepo) {
      try {
        await appendToMemory(settings.githubToken, settings.githubRepo, body.message.trim());
        memorySaved = true;
      } catch (err) {
        logger.error({ err }, "Failed to save auto-detected memory note");
      }
    }

    await db.insert(chatMessagesTable).values({
      role: "assistant",
      content: assistantMessage,
      command,
    });

    // Auto-sync to GitHub every N turns
    let synced = false;
    if (settings.githubToken && settings.githubRepo) {
      const [{ count }] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(chatMessagesTable);
      const msgCount = count ?? 0;
      if (msgCount > 0 && msgCount % (MEMORY_INJECT_TURNS * 2) === 0) {
        try {
          const allMessages = await db.select().from(chatMessagesTable).orderBy(chatMessagesTable.createdAt);
          await syncSessionToGitHub(settings.githubToken, settings.githubRepo, allMessages);
          synced = true;
        } catch (err) {
          logger.error({ err }, "Auto-sync to GitHub failed");
        }
      }
    }

    res.json({ message: assistantMessage, role: "assistant", command, done, memorySaved, synced });
  } catch (err) {
    logger.error({ err }, "Failed to call AI API");
    res.status(500).json({ error: "Failed to reach AI API. Check your endpoint URL." });
  }
});

export default router;
