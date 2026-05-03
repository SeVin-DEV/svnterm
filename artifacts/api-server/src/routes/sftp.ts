import { Router, type IRouter } from "express";
import multer from "multer";
import { withSftp, listDir } from "../sftp-helper";
import { logger } from "../lib/logger";
import path from "path";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function getConnId(req: Parameters<Parameters<IRouter["get"]>[1]>[0]): number {
  const id = Number(req.query["connectionId"]);
  if (!id || isNaN(id)) throw new Error("connectionId is required");
  return id;
}

function getPath(req: Parameters<Parameters<IRouter["get"]>[1]>[0]): string {
  const p = req.query["path"] as string;
  if (!p) throw new Error("path is required");
  return p;
}

// List directory
router.get("/sftp/list", async (req, res) => {
  try {
    const connId = getConnId(req);
    const remotePath = (req.query["path"] as string) || "/";
    const entries = await withSftp(connId, (sftp) => listDir(sftp, remotePath));
    res.json({ path: remotePath, entries });
  } catch (err) {
    logger.error({ err }, "SFTP list error");
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Read file as text (for AI sharing) - max 100KB
router.get("/sftp/read", async (req, res) => {
  try {
    const connId = getConnId(req);
    const remotePath = getPath(req);
    const MAX_BYTES = 100 * 1024;

    const content = await withSftp(connId, (sftp) => {
      return new Promise<string>((resolve, reject) => {
        const stream = sftp.createReadStream(remotePath, { encoding: "utf8" });
        const chunks: string[] = [];
        let total = 0;
        stream.on("data", (chunk: string) => {
          total += chunk.length;
          chunks.push(chunk);
          if (total >= MAX_BYTES) stream.destroy();
        });
        stream.on("close", () => resolve(chunks.join("")));
        stream.on("error", reject);
      });
    });

    res.json({ path: remotePath, content, truncated: content.length >= MAX_BYTES });
  } catch (err) {
    logger.error({ err }, "SFTP read error");
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Write file content (in-browser editor save)
router.put("/sftp/write", async (req, res) => {
  try {
    const { connectionId, path: remotePath, content } = req.body as {
      connectionId: unknown;
      path: unknown;
      content: unknown;
    };
    const connId = Number(connectionId);
    if (!connId || isNaN(connId)) { res.status(400).json({ error: "connectionId required" }); return; }
    if (!remotePath || typeof remotePath !== "string") { res.status(400).json({ error: "path required" }); return; }
    if (typeof content !== "string") { res.status(400).json({ error: "content must be a string" }); return; }

    const buf = Buffer.from(content, "utf-8");
    await withSftp(connId, (sftp) => {
      return new Promise<void>((resolve, reject) => {
        const stream = sftp.createWriteStream(remotePath, { flags: "w" });
        stream.on("error", reject);
        stream.on("close", resolve);
        stream.end(buf);
      });
    });

    res.json({ success: true, bytes: buf.length });
  } catch (err) {
    logger.error({ err }, "SFTP write error");
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Download file
router.get("/sftp/download", async (req, res) => {
  try {
    const connId = getConnId(req);
    const remotePath = getPath(req);
    const filename = path.basename(remotePath);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/octet-stream");

    await withSftp(connId, (sftp) => {
      return new Promise<void>((resolve, reject) => {
        const stream = sftp.createReadStream(remotePath);
        stream.on("error", reject);
        stream.on("close", resolve);
        stream.pipe(res);
      });
    });
  } catch (err) {
    logger.error({ err }, "SFTP download error");
    if (!res.headersSent) {
      res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
    }
  }
});

// Upload file
router.post("/sftp/upload", upload.single("file"), async (req, res) => {
  try {
    const connId = Number(req.body["connectionId"]);
    if (!connId || isNaN(connId)) { res.status(400).json({ error: "connectionId required" }); return; }
    const remotePath = req.body["path"] as string;
    if (!remotePath) { res.status(400).json({ error: "path required" }); return; }
    if (!req.file) { res.status(400).json({ error: "file required" }); return; }

    const buffer = req.file.buffer;
    const destPath = remotePath.endsWith("/")
      ? remotePath + req.file.originalname
      : remotePath;

    await withSftp(connId, (sftp) => {
      return new Promise<void>((resolve, reject) => {
        const stream = sftp.createWriteStream(destPath);
        stream.on("error", reject);
        stream.on("close", resolve);
        stream.end(buffer);
      });
    });

    res.json({ success: true, path: destPath });
  } catch (err) {
    logger.error({ err }, "SFTP upload error");
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Delete file or directory
router.delete("/sftp/delete", async (req, res) => {
  try {
    const connId = getConnId(req);
    const remotePath = getPath(req);
    const isDir = req.query["isDir"] === "true";

    await withSftp(connId, (sftp) => {
      return new Promise<void>((resolve, reject) => {
        if (isDir) {
          sftp.rmdir(remotePath, (err) => { if (err) reject(err); else resolve(); });
        } else {
          sftp.unlink(remotePath, (err) => { if (err) reject(err); else resolve(); });
        }
      });
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "SFTP delete error");
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Create directory
router.post("/sftp/mkdir", async (req, res) => {
  try {
    const { connectionId, path: remotePath } = req.body as { connectionId: number; path: string };
    if (!connectionId || !remotePath) { res.status(400).json({ error: "connectionId and path required" }); return; }

    await withSftp(Number(connectionId), (sftp) => {
      return new Promise<void>((resolve, reject) => {
        sftp.mkdir(remotePath, (err) => { if (err) reject(err); else resolve(); });
      });
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "SFTP mkdir error");
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// Rename / move
router.post("/sftp/rename", async (req, res) => {
  try {
    const { connectionId, oldPath, newPath } = req.body as { connectionId: number; oldPath: string; newPath: string };
    if (!connectionId || !oldPath || !newPath) { res.status(400).json({ error: "connectionId, oldPath, newPath required" }); return; }

    await withSftp(Number(connectionId), (sftp) => {
      return new Promise<void>((resolve, reject) => {
        sftp.rename(oldPath, newPath, (err) => { if (err) reject(err); else resolve(); });
      });
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "SFTP rename error");
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

export default router;
