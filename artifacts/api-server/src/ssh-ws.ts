import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server } from "http";
import { Client as SshClient } from "ssh2";
import { db } from "@workspace/db";
import { sshConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger";

interface WsMessage {
  type: "connect" | "data" | "resize" | "disconnect";
  connectionId?: number;
  data?: string;
  cols?: number;
  rows?: number;
}

export function setupSshWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/api/ssh/ws" });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    let sshClient: SshClient | null = null;
    let stream: ReturnType<SshClient["shell"]> extends Promise<infer T> ? T : never | null = null;
    let shellStream: NodeJS.ReadWriteStream | null = null;

    const send = (type: string, data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, data }));
      }
    };

    ws.on("message", async (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsMessage;
      } catch {
        return;
      }

      if (msg.type === "connect" && msg.connectionId) {
        if (sshClient) {
          sshClient.end();
          sshClient = null;
          shellStream = null;
        }

        const [conn] = await db
          .select()
          .from(sshConnectionsTable)
          .where(eq(sshConnectionsTable.id, msg.connectionId));

        if (!conn) {
          send("error", "Connection not found");
          return;
        }

        send("status", "connecting");

        const client = new SshClient();
        sshClient = client;

        const connectConfig: Parameters<SshClient["connect"]>[0] = {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          readyTimeout: 15000,
        };

        if (conn.authType === "password" && conn.password) {
          connectConfig.password = conn.password;
        } else if (conn.authType === "key" && conn.privateKey) {
          connectConfig.privateKey = conn.privateKey;
          if (conn.passphrase) connectConfig.passphrase = conn.passphrase;
        }

        client.on("ready", () => {
          send("status", "connected");
          client.shell({ term: "xterm-256color", cols: 220, rows: 50 }, (err, s) => {
            if (err) {
              send("error", `Shell error: ${err.message}`);
              client.end();
              return;
            }
            shellStream = s;
            s.on("data", (data: Buffer) => {
              send("data", data.toString("binary"));
            });
            s.stderr.on("data", (data: Buffer) => {
              send("data", data.toString("binary"));
            });
            s.on("close", () => {
              send("status", "disconnected");
              if (ws.readyState === WebSocket.OPEN) {
                ws.close();
              }
            });
          });
        });

        client.on("error", (err) => {
          logger.error({ err, host: conn.host }, "SSH connection error");
          send("error", `SSH error: ${err.message}`);
          send("status", "disconnected");
        });

        client.on("close", () => {
          send("status", "disconnected");
        });

        try {
          client.connect(connectConfig);
        } catch (err) {
          logger.error({ err }, "SSH connect failed");
          send("error", "Failed to initiate connection");
        }
      } else if (msg.type === "data" && msg.data !== undefined) {
        if (shellStream) {
          shellStream.write(msg.data);
        }
      } else if (msg.type === "resize" && msg.cols && msg.rows) {
        if (shellStream && "setWindow" in shellStream) {
          (shellStream as { setWindow: (rows: number, cols: number, height: number, width: number) => void }).setWindow(
            msg.rows, msg.cols, 0, 0
          );
        }
      } else if (msg.type === "disconnect") {
        if (sshClient) {
          sshClient.end();
          sshClient = null;
          shellStream = null;
        }
        send("status", "disconnected");
      }
    });

    ws.on("close", () => {
      if (sshClient) {
        sshClient.end();
        sshClient = null;
      }
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
    });
  });

  logger.info("SSH WebSocket server attached at /api/ssh/ws");
}
