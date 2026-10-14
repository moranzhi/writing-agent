/**
 * 直聊持久化：{用户数据}/direct-chats/
 *   shells/<shellId>.json
 *   conversations/<conversationId>.json
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { getDirectChatsDir } from "../config/user-data-dir.js";
import {
  EMPTY_SHELL_SLOTS,
  countTurnMessages,
  migrateMessagesToTurns,
  type DirectChatConversation,
  type DirectChatConversationSummary,
  type DirectChatMessage,
  type DirectChatShell,
  type DirectChatShellSlots,
  type DirectChatShellSummary,
  type DirectChatTurn,
  type DirectChatWindow,
} from "./types.js";

export { getDirectChatsDir };

function shellsDir(): string {
  return path.join(getDirectChatsDir(), "shells");
}

function conversationsDir(): string {
  return path.join(getDirectChatsDir(), "conversations");
}

export function ensureDirectChatDirs(): void {
  mkdirSync(shellsDir(), { recursive: true });
  mkdirSync(conversationsDir(), { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

function asString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return v;
}

function readJson(file: string): unknown | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, file);
}

function shellPath(id: string): string {
  return path.join(shellsDir(), `${id}.json`);
}

function conversationPath(id: string): string {
  return path.join(conversationsDir(), `${id}.json`);
}

function parseShell(raw: unknown): DirectChatShell | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = asString(row.id)?.trim();
  const name = asString(row.name)?.trim();
  if (!id || !name) return null;
  const presetRaw = row.presetId;
  const presetId =
    presetRaw === null || presetRaw === undefined
      ? null
      : typeof presetRaw === "string" && presetRaw.trim()
        ? presetRaw.trim()
        : null;
  return {
    id,
    name,
    systemPrompt: asString(row.systemPrompt) ?? "",
    loreBefore: asString(row.loreBefore) ?? "",
    seedHistory: asString(row.seedHistory) ?? "",
    loreAfter: asString(row.loreAfter) ?? "",
    postTurn: asString(row.postTurn) ?? "",
    presetId,
    createdAt: asString(row.createdAt) ?? nowIso(),
    updatedAt: asString(row.updatedAt) ?? nowIso(),
  };
}

function parseMessage(raw: unknown): DirectChatMessage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = asString(row.id)?.trim();
  const role = asString(row.role);
  const content = asString(row.content);
  if (!id || (role !== "user" && role !== "assistant") || content == null) {
    return null;
  }
  const msg: DirectChatMessage = {
    id,
    role,
    content,
    createdAt: asString(row.createdAt) ?? nowIso(),
  };
  if (typeof row.thinking === "string" && row.thinking) msg.thinking = row.thinking;
  if (typeof row.model === "string" && row.model) msg.model = row.model;
  if (row.contextTrace && typeof row.contextTrace === "object") {
    msg.contextTrace = row.contextTrace as DirectChatMessage["contextTrace"];
  }
  if (Array.isArray(row.variants)) {
    msg.variants = row.variants as DirectChatMessage["variants"];
  }
  if (typeof row.branchIndex === "number" && Number.isFinite(row.branchIndex)) {
    msg.branchIndex = row.branchIndex;
  }
  return msg;
}

function parseWindow(raw: unknown): DirectChatWindow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = asString(row.id)?.trim();
  const profileId = asString(row.profileId)?.trim();
  if (!id || !profileId) return null;
  return {
    id,
    profileId,
    ...(asString(row.profileName) ? { profileName: asString(row.profileName) } : {}),
    ...(asString(row.model) ? { model: asString(row.model) } : {}),
  };
}

function parseTurn(raw: unknown): DirectChatTurn | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = asString(row.id)?.trim();
  const userRaw = row.user;
  if (!id || !userRaw || typeof userRaw !== "object" || Array.isArray(userRaw)) {
    return null;
  }
  const userRow = userRaw as Record<string, unknown>;
  const userContent = asString(userRow.content);
  if (userContent == null) return null;
  const replies: DirectChatTurn["replies"] = [];
  if (Array.isArray(row.replies)) {
    for (const r of row.replies) {
      if (!r || typeof r !== "object" || Array.isArray(r)) continue;
      const rr = r as Record<string, unknown>;
      const windowId = asString(rr.windowId)?.trim();
      const content = asString(rr.content);
      if (!windowId || content == null) continue;
      replies.push({
        windowId,
        content,
        ...(typeof rr.thinking === "string" && rr.thinking
          ? { thinking: rr.thinking }
          : {}),
        ...(typeof rr.model === "string" && rr.model ? { model: rr.model } : {}),
        ...(typeof rr.error === "string" && rr.error ? { error: rr.error } : {}),
        ...(rr.contextTrace && typeof rr.contextTrace === "object"
          ? { contextTrace: rr.contextTrace as DirectChatMessage["contextTrace"] }
          : {}),
      });
    }
  }
  const selected =
    row.selectedWindowId === null
      ? null
      : asString(row.selectedWindowId)?.trim() || undefined;
  return {
    id,
    user: {
      content: userContent,
      createdAt: asString(userRow.createdAt) ?? nowIso(),
    },
    replies,
    ...(selected !== undefined ? { selectedWindowId: selected } : {}),
    createdAt: asString(row.createdAt) ?? nowIso(),
  };
}

function parseConversation(raw: unknown): DirectChatConversation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = asString(row.id)?.trim();
  const shellId = asString(row.shellId)?.trim();
  const name = asString(row.name)?.trim();
  if (!id || !shellId || !name) return null;
  const messages: DirectChatMessage[] = [];
  if (Array.isArray(row.messages)) {
    for (const m of row.messages) {
      const parsed = parseMessage(m);
      if (parsed) messages.push(parsed);
    }
  }
  const windows: DirectChatWindow[] = [];
  if (Array.isArray(row.windows)) {
    for (const w of row.windows) {
      const parsed = parseWindow(w);
      if (parsed) windows.push(parsed);
    }
  }
  let turns: DirectChatTurn[] = [];
  if (Array.isArray(row.turns)) {
    for (const t of row.turns) {
      const parsed = parseTurn(t);
      if (parsed) turns.push(parsed);
    }
  }
  if (!turns.length && messages.length) {
    const wid = windows[0]?.id ?? "default";
    turns = migrateMessagesToTurns(messages, wid);
    if (!windows.length) {
      windows.push({ id: wid, profileId: "", profileName: "默认" });
    }
  }
  return {
    id,
    shellId,
    name,
    messages,
    windows,
    turns,
    createdAt: asString(row.createdAt) ?? nowIso(),
    updatedAt: asString(row.updatedAt) ?? nowIso(),
  };
}

export function listShells(): DirectChatShellSummary[] {
  ensureDirectChatDirs();
  const root = shellsDir();
  if (!existsSync(root)) return [];
  const out: DirectChatShellSummary[] = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".json")) continue;
    const shell = parseShell(readJson(path.join(root, name)));
    if (!shell) continue;
    const conversationCount = listConversations(shell.id).length;
    out.push({
      id: shell.id,
      name: shell.name,
      presetId: shell.presetId,
      conversationCount,
      updatedAt: shell.updatedAt,
    });
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export function getShell(id: string): DirectChatShell | null {
  const key = id.trim();
  if (!key) return null;
  ensureDirectChatDirs();
  return parseShell(readJson(shellPath(key)));
}

export function createShell(input: {
  name?: string;
  slots?: Partial<DirectChatShellSlots>;
  presetId?: string | null;
}): DirectChatShell {
  ensureDirectChatDirs();
  const ts = nowIso();
  const slots = { ...EMPTY_SHELL_SLOTS, ...input.slots };
  const shell: DirectChatShell = {
    id: randomUUID(),
    name: (input.name?.trim() || "未命名上下文") as string,
    ...slots,
    presetId:
      input.presetId === undefined
        ? null
        : input.presetId && input.presetId.trim()
          ? input.presetId.trim()
          : null,
    createdAt: ts,
    updatedAt: ts,
  };
  writeJsonAtomic(shellPath(shell.id), shell);
  return shell;
}

export function updateShell(
  id: string,
  patch: Partial<
    Pick<
      DirectChatShell,
      | "name"
      | "systemPrompt"
      | "loreBefore"
      | "seedHistory"
      | "loreAfter"
      | "postTurn"
      | "presetId"
    >
  >,
): DirectChatShell {
  const existing = getShell(id);
  if (!existing) throw new Error("上下文壳不存在");
  const next: DirectChatShell = {
    ...existing,
    name:
      patch.name !== undefined
        ? patch.name.trim() || existing.name
        : existing.name,
    systemPrompt:
      patch.systemPrompt !== undefined ? patch.systemPrompt : existing.systemPrompt,
    loreBefore:
      patch.loreBefore !== undefined ? patch.loreBefore : existing.loreBefore,
    seedHistory:
      patch.seedHistory !== undefined ? patch.seedHistory : existing.seedHistory,
    loreAfter:
      patch.loreAfter !== undefined ? patch.loreAfter : existing.loreAfter,
    postTurn: patch.postTurn !== undefined ? patch.postTurn : existing.postTurn,
    presetId:
      patch.presetId !== undefined
        ? patch.presetId && patch.presetId.trim()
          ? patch.presetId.trim()
          : null
        : existing.presetId,
    updatedAt: nowIso(),
  };
  writeJsonAtomic(shellPath(next.id), next);
  return next;
}

export function deleteShell(id: string): void {
  const shell = getShell(id);
  if (!shell) throw new Error("上下文壳不存在");
  for (const c of listConversations(shell.id)) {
    deleteConversation(c.id);
  }
  const file = shellPath(shell.id);
  if (existsSync(file)) unlinkSync(file);
}

export function listConversations(
  shellId: string,
): DirectChatConversationSummary[] {
  ensureDirectChatDirs();
  const key = shellId.trim();
  if (!key) return [];
  const root = conversationsDir();
  if (!existsSync(root)) return [];
  const out: DirectChatConversationSummary[] = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".json")) continue;
    const conv = parseConversation(readJson(path.join(root, name)));
    if (!conv || conv.shellId !== key) continue;
    out.push({
      id: conv.id,
      shellId: conv.shellId,
      name: conv.name,
      messageCount: countTurnMessages(conv.turns),
      updatedAt: conv.updatedAt,
    });
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export function getConversation(id: string): DirectChatConversation | null {
  const key = id.trim();
  if (!key) return null;
  ensureDirectChatDirs();
  return parseConversation(readJson(conversationPath(key)));
}

export function createConversation(input: {
  shellId: string;
  name?: string;
  messages?: DirectChatMessage[];
  windows?: DirectChatWindow[];
  turns?: DirectChatTurn[];
}): DirectChatConversation {
  const shell = getShell(input.shellId);
  if (!shell) throw new Error("上下文壳不存在");
  ensureDirectChatDirs();
  const ts = nowIso();
  const windows = Array.isArray(input.windows) ? input.windows : [];
  let turns = Array.isArray(input.turns) ? input.turns : [];
  const messages = Array.isArray(input.messages) ? input.messages : [];
  if (!turns.length && messages.length) {
    turns = migrateMessagesToTurns(messages, windows[0]?.id ?? "default");
  }
  const conv: DirectChatConversation = {
    id: randomUUID(),
    shellId: shell.id,
    name: (input.name?.trim() || "未命名会话") as string,
    messages,
    windows,
    turns,
    createdAt: ts,
    updatedAt: ts,
  };
  writeJsonAtomic(conversationPath(conv.id), conv);
  updateShell(shell.id, {});
  return conv;
}

export function updateConversation(
  id: string,
  patch: Partial<
    Pick<DirectChatConversation, "name" | "messages" | "windows" | "turns">
  >,
): DirectChatConversation {
  const existing = getConversation(id);
  if (!existing) throw new Error("会话不存在");
  const next: DirectChatConversation = {
    ...existing,
    name:
      patch.name !== undefined
        ? patch.name.trim() || existing.name
        : existing.name,
    messages:
      patch.messages !== undefined ? patch.messages : existing.messages,
    windows: patch.windows !== undefined ? patch.windows : existing.windows,
    turns: patch.turns !== undefined ? patch.turns : existing.turns,
    updatedAt: nowIso(),
  };
  writeJsonAtomic(conversationPath(next.id), next);
  return next;
}

export function deleteConversation(id: string): void {
  const conv = getConversation(id);
  if (!conv) throw new Error("会话不存在");
  const file = conversationPath(conv.id);
  if (existsSync(file)) unlinkSync(file);
}

export function saveConversation(conv: DirectChatConversation): DirectChatConversation {
  const next = { ...conv, updatedAt: nowIso() };
  ensureDirectChatDirs();
  writeJsonAtomic(conversationPath(next.id), next);
  return next;
}

/** 将临时会话升为持久：可选新建壳，或挂到已有壳下 */
export function promoteTemporary(input: {
  shell?: {
    name?: string;
    slots?: Partial<DirectChatShellSlots>;
    presetId?: string | null;
  };
  shellId?: string;
  conversationName?: string;
  messages?: DirectChatMessage[];
  windows?: DirectChatWindow[];
  turns?: DirectChatTurn[];
}): { shell: DirectChatShell; conversation: DirectChatConversation } {
  let shell: DirectChatShell;
  if (input.shellId) {
    const existing = getShell(input.shellId);
    if (!existing) throw new Error("上下文壳不存在");
    shell = existing;
  } else {
    shell = createShell({
      name: input.shell?.name,
      slots: input.shell?.slots,
      presetId: input.shell?.presetId,
    });
  }
  const conversation = createConversation({
    shellId: shell.id,
    name: input.conversationName,
    messages: input.messages,
    windows: input.windows,
    turns: input.turns,
  });
  return { shell, conversation };
}
