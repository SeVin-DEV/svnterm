import { Client, type SFTPWrapper } from "ssh2";
import { db } from "@workspace/db";
import { sshConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface SftpFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modified: number; // unix ms
  permissions: string;
}

export async function withSftp<T>(
  connectionId: number,
  fn: (sftp: SFTPWrapper) => Promise<T>,
): Promise<T> {
  const [conn] = await db
    .select()
    .from(sshConnectionsTable)
    .where(eq(sshConnectionsTable.id, connectionId));

  if (!conn) throw new Error("SSH connection not found");

  return new Promise<T>((resolve, reject) => {
    const client = new Client();

    client.on("ready", () => {
      client.sftp((err, sftp) => {
        if (err) {
          client.end();
          reject(err);
          return;
        }
        fn(sftp)
          .then((result) => {
            client.end();
            resolve(result);
          })
          .catch((e: unknown) => {
            client.end();
            reject(e);
          });
      });
    });

    client.on("error", (err) => reject(err));

    const connectConfig: Parameters<Client["connect"]>[0] = {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      readyTimeout: 10000,
    };

    if (conn.authType === "key" && conn.privateKey) {
      connectConfig.privateKey = conn.privateKey;
      if (conn.passphrase) connectConfig.passphrase = conn.passphrase;
    } else if (conn.password) {
      connectConfig.password = conn.password;
    }

    client.connect(connectConfig);
  });
}

export function listDir(sftp: SFTPWrapper, remotePath: string): Promise<SftpFileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) { reject(err); return; }
      const entries: SftpFileEntry[] = list.map((item) => {
        const attrs = item.attrs;
        const isDirectory = !!(attrs.mode && (attrs.mode & 0o040000) !== 0);
        const isSymlink = !!(attrs.mode && (attrs.mode & 0o120000) === 0o120000);
        const perms = attrs.mode ? modeToString(attrs.mode) : "----------";
        const full = remotePath.replace(/\/$/, "") + "/" + item.filename;
        return {
          name: item.filename,
          path: full,
          isDirectory,
          isSymlink,
          size: attrs.size ?? 0,
          modified: attrs.mtime ? attrs.mtime * 1000 : 0,
          permissions: perms,
        };
      });
      // Sort: directories first, then alphabetically
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      resolve(entries);
    });
  });
}

function modeToString(mode: number): string {
  const chars = "rwxrwxrwx";
  let result = "";
  for (let i = 8; i >= 0; i--) {
    result += (mode >> i) & 1 ? chars[8 - i] : "-";
  }
  return result;
}
