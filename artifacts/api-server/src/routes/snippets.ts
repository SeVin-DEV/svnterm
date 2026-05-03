import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { snippetsTable } from "@workspace/db";
import { CreateSnippetBody, UpdateSnippetBody, UpdateSnippetParams, DeleteSnippetParams } from "@workspace/api-zod";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/snippets", async (_req, res) => {
  const snippets = await db.select().from(snippetsTable).orderBy(snippetsTable.createdAt);
  res.json(snippets);
});

router.post("/snippets", async (req, res) => {
  const body = CreateSnippetBody.parse(req.body);
  const [snippet] = await db
    .insert(snippetsTable)
    .values({
      title: body.title,
      command: body.command,
      description: body.description,
      category: body.category,
    })
    .returning();
  res.status(201).json(snippet);
});

router.put("/snippets/:id", async (req, res) => {
  const { id } = UpdateSnippetParams.parse({ id: Number(req.params.id) });
  const body = UpdateSnippetBody.parse(req.body);
  const [snippet] = await db
    .update(snippetsTable)
    .set({
      title: body.title,
      command: body.command,
      description: body.description,
      category: body.category,
    })
    .where(eq(snippetsTable.id, id))
    .returning();
  if (!snippet) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(snippet);
});

router.delete("/snippets/:id", async (req, res) => {
  const { id } = DeleteSnippetParams.parse({ id: Number(req.params.id) });
  await db.delete(snippetsTable).where(eq(snippetsTable.id, id));
  res.status(204).send();
});

export default router;
