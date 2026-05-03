import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { aiSettingsTable } from "@workspace/db";
import { UpdateAiSettingsBody } from "@workspace/api-zod";

const router: IRouter = Router();

async function getOrCreateSettings() {
  const [existing] = await db.select().from(aiSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(aiSettingsTable)
    .values({ endpointUrl: "https://api.openai.com/v1", modelName: "gpt-4o" })
    .returning();
  return created;
}

router.get("/ai-settings", async (_req, res) => {
  const settings = await getOrCreateSettings();
  res.json({
    id: settings.id,
    endpointUrl: settings.endpointUrl,
    modelName: settings.modelName,
    systemPrompt: settings.systemPrompt,
    hasApiKey: !!settings.apiKey,
    apiKey: settings.apiKey
      ? `****${settings.apiKey.slice(-4)}`
      : undefined,
    hasGithubToken: !!settings.githubToken,
    githubRepo: settings.githubRepo ?? undefined,
  });
});

router.put("/ai-settings", async (req, res) => {
  const body = UpdateAiSettingsBody.parse(req.body);
  const settings = await getOrCreateSettings();

  const updateData: Partial<typeof aiSettingsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.endpointUrl !== undefined) updateData.endpointUrl = body.endpointUrl;
  if (body.modelName !== undefined) updateData.modelName = body.modelName;
  if (body.systemPrompt !== undefined) updateData.systemPrompt = body.systemPrompt;
  if (body.apiKey !== undefined && body.apiKey.trim()) updateData.apiKey = body.apiKey.trim();
  if (body.githubToken !== undefined) updateData.githubToken = body.githubToken.trim() || null;
  if (body.githubRepo !== undefined) updateData.githubRepo = body.githubRepo.trim() || null;

  const [updated] = await db
    .update(aiSettingsTable)
    .set(updateData)
    .returning();

  res.json({
    id: updated.id,
    endpointUrl: updated.endpointUrl,
    modelName: updated.modelName,
    systemPrompt: updated.systemPrompt,
    hasApiKey: !!updated.apiKey,
    apiKey: updated.apiKey
      ? `****${updated.apiKey.slice(-4)}`
      : undefined,
    hasGithubToken: !!updated.githubToken,
    githubRepo: updated.githubRepo ?? undefined,
  });
});

export default router;
