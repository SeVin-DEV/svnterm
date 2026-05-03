import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sshConnectionsTable } from "@workspace/db";
import { CreateSshConnectionBody, UpdateSshConnectionBody, GetSshConnectionParams, DeleteSshConnectionParams, UpdateSshConnectionParams } from "@workspace/api-zod";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/ssh-connections", async (req, res) => {
  const connections = await db
    .select({
      id: sshConnectionsTable.id,
      name: sshConnectionsTable.name,
      host: sshConnectionsTable.host,
      port: sshConnectionsTable.port,
      username: sshConnectionsTable.username,
      authType: sshConnectionsTable.authType,
      createdAt: sshConnectionsTable.createdAt,
      updatedAt: sshConnectionsTable.updatedAt,
    })
    .from(sshConnectionsTable);
  res.json(connections);
});

router.post("/ssh-connections", async (req, res) => {
  const body = CreateSshConnectionBody.parse(req.body);
  const [conn] = await db
    .insert(sshConnectionsTable)
    .values({
      name: body.name,
      host: body.host,
      port: body.port,
      username: body.username,
      authType: body.authType,
      password: body.password,
      privateKey: body.privateKey,
      passphrase: body.passphrase,
    })
    .returning();
  res.status(201).json({
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    authType: conn.authType,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  });
});

router.get("/ssh-connections/:id", async (req, res) => {
  const { id } = GetSshConnectionParams.parse({ id: Number(req.params.id) });
  const [conn] = await db
    .select()
    .from(sshConnectionsTable)
    .where(eq(sshConnectionsTable.id, id));
  if (!conn) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    authType: conn.authType,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  });
});

router.put("/ssh-connections/:id", async (req, res) => {
  const { id } = UpdateSshConnectionParams.parse({ id: Number(req.params.id) });
  const body = UpdateSshConnectionBody.parse(req.body);
  const [conn] = await db
    .update(sshConnectionsTable)
    .set({
      name: body.name,
      host: body.host,
      port: body.port,
      username: body.username,
      authType: body.authType,
      password: body.password,
      privateKey: body.privateKey,
      passphrase: body.passphrase,
      updatedAt: new Date(),
    })
    .where(eq(sshConnectionsTable.id, id))
    .returning();
  if (!conn) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    authType: conn.authType,
    createdAt: conn.createdAt,
    updatedAt: conn.updatedAt,
  });
});

router.delete("/ssh-connections/:id", async (req, res) => {
  const { id } = DeleteSshConnectionParams.parse({ id: Number(req.params.id) });
  await db.delete(sshConnectionsTable).where(eq(sshConnectionsTable.id, id));
  res.status(204).send();
});

export default router;
