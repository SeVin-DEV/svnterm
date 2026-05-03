import { pgTable, text, integer, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sshConnectionsTable = pgTable("ssh_connections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(22),
  username: text("username").notNull(),
  authType: text("auth_type").notNull().default("password"),
  password: text("password"),
  privateKey: text("private_key"),
  passphrase: text("passphrase"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSshConnectionSchema = createInsertSchema(sshConnectionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSshConnection = z.infer<typeof insertSshConnectionSchema>;
export type SshConnection = typeof sshConnectionsTable.$inferSelect;

export const snippetsTable = pgTable("snippets", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  command: text("command").notNull(),
  description: text("description"),
  category: text("category"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSnippetSchema = createInsertSchema(snippetsTable).omit({ id: true, createdAt: true });
export type InsertSnippet = z.infer<typeof insertSnippetSchema>;
export type Snippet = typeof snippetsTable.$inferSelect;

export const aiSettingsTable = pgTable("ai_settings", {
  id: serial("id").primaryKey(),
  apiKey: text("api_key"),
  endpointUrl: text("endpoint_url").notNull().default("https://api.openai.com/v1"),
  modelName: text("model_name").notNull().default("gpt-4o"),
  systemPrompt: text("system_prompt"),
  githubToken: text("github_token"),
  githubRepo: text("github_repo"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AiSettings = typeof aiSettingsTable.$inferSelect;

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  command: text("command"),
  terminalContext: text("terminal_context"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ChatMessage = typeof chatMessagesTable.$inferSelect;
