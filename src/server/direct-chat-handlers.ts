import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createConversation,
  createShell,
  deleteConversation,
  deleteShell,
  EMPTY_SHELL_SLOTS,
  getConversation,
  getShell,
  listConversations,
  listShells,
  promoteTemporary,
  runDirectChatMultiTurn,
  saveConversation,
  updateConversation,
  updateShell,
  type DirectChatAssistantReply,
  type DirectChatConversation,
  type DirectChatMessage,
  type DirectChatMultiTurnResult,
  type DirectChatMultiWindowResult,
  type DirectChatShellSlots,
  type DirectChatStreamDelta,
  type DirectChatTurn,
  type DirectChatWindow,
} from "../direct-chat/index.js";
import { listProfilesForCompare } from "./model-compare.js";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function wantsNdjson(req: IncomingMessage): boolean {
  return String(req.headers.accept || "").includes("application/x-ndjson");
}

type MultiStreamHooks = {
  onDelta: (event: DirectChatStreamDelta) => void;
  onWindow: (result: DirectChatMultiWindowResult) => void;
};

function replyFromWindowResult(
  result: DirectChatMultiWindowResult,
): DirectChatAssistantReply {
  return {
    windowId: result.windowId,
    content: result.reply ?? "",
    ...(result.reasoning ? { thinking: result.reasoning } : {}),
    ...(result.model ? { model: result.model } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.contextTrace ? { contextTrace: result.contextTrace } : {}),
  };
}

/** 流式增量按窗口累加，并定期写入会话，避免刷新后丢掉已生成的正文 */
function createStreamingSaver(
  conversation: DirectChatConversation,
  windows: DirectChatWindow[],
  text: string,
  turnId: string,
) {
  const ts = new Date().toISOString();
  const replies: DirectChatAssistantReply[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const saveNow = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (closed) return;
    const turn: DirectChatTurn = {
      id: turnId,
      user: { content: text, createdAt: ts },
      replies: replies.map((r) => ({ ...r })),
      createdAt: ts,
    };
    saveConversation({
      ...conversation,
      windows,
      turns: [...conversation.turns.filter((t) => t.id !== turnId), turn],
    });
  };

  const saveSoon = () => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      saveNow();
    }, 400);
  };

  return {
    onDelta(event: DirectChatStreamDelta) {
      let reply = replies.find((r) => r.windowId === event.windowId);
      if (!reply) {
        reply = { windowId: event.windowId, content: "" };
        replies.push(reply);
      }
      if (event.field === "thinking") {
        reply.thinking = `${reply.thinking || ""}${event.delta}`;
      } else {
        reply.content += event.delta;
      }
      saveSoon();
    },
    onWindow(result: DirectChatMultiWindowResult) {
      const next = replyFromWindowResult(result);
      const idx = replies.findIndex((r) => r.windowId === result.windowId);
      if (idx >= 0) replies[idx] = next;
      else replies.push(next);
      saveNow();
    },
    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

async function writeMultiStream(
  res: ServerResponse,
  run: (hooks: MultiStreamHooks) => Promise<DirectChatMultiTurnResult>,
  finish: (multi: DirectChatMultiTurnResult) => Record<string, unknown>,
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });
  const writeEvent = (event: unknown) => {
    res.write(`${JSON.stringify(event)}\n`);
  };
  try {
    const multi = await run({
      onDelta: (event) => writeEvent({ type: "delta", ...event }),
      onWindow: (result) => writeEvent({ type: "window", result }),
    });
    writeEvent({ type: "done", multi, ...finish(multi) });
    res.end();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    try {
      writeEvent({ type: "error", error });
      res.end();
    } catch {
      res.destroy();
    }
  }
}

function slotsFromBody(body: Record<string, unknown>): DirectChatShellSlots {
  return {
    systemPrompt:
      typeof body.systemPrompt === "string"
        ? body.systemPrompt
        : EMPTY_SHELL_SLOTS.systemPrompt,
    loreBefore:
      typeof body.loreBefore === "string"
        ? body.loreBefore
        : EMPTY_SHELL_SLOTS.loreBefore,
    seedHistory:
      typeof body.seedHistory === "string"
        ? body.seedHistory
        : EMPTY_SHELL_SLOTS.seedHistory,
    loreAfter:
      typeof body.loreAfter === "string"
        ? body.loreAfter
        : EMPTY_SHELL_SLOTS.loreAfter,
    postTurn:
      typeof body.postTurn === "string"
        ? body.postTurn
        : EMPTY_SHELL_SLOTS.postTurn,
  };
}

export async function handleDirectChatApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!pathname.startsWith("/api/direct-chat")) return false;

  try {
    if (req.method === "GET" && pathname === "/api/direct-chat/shells") {
      json(res, 200, { shells: listShells() });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/direct-chat/shells") {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const shell = createShell({
        name: typeof body.name === "string" ? body.name : undefined,
        slots: slotsFromBody(body),
        presetId:
          body.presetId === null
            ? null
            : typeof body.presetId === "string"
              ? body.presetId
              : undefined,
      });
      json(res, 201, { shell });
      return true;
    }

    const shellMatch = pathname.match(
      /^\/api\/direct-chat\/shells\/([^/]+)(\/.*)?$/,
    );
    if (shellMatch) {
      const shellId = decodeURIComponent(shellMatch[1]!);
      const sub = shellMatch[2] ?? "";

      if (req.method === "GET" && sub === "") {
        const shell = getShell(shellId);
        if (!shell) {
          json(res, 404, { error: "上下文壳不存在" });
          return true;
        }
        json(res, 200, {
          shell,
          conversations: listConversations(shellId),
        });
        return true;
      }

      if (
        (req.method === "PATCH" || req.method === "PUT") &&
        sub === ""
      ) {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        try {
          const shell = updateShell(shellId, {
            name: typeof body.name === "string" ? body.name : undefined,
            systemPrompt:
              typeof body.systemPrompt === "string"
                ? body.systemPrompt
                : undefined,
            loreBefore:
              typeof body.loreBefore === "string" ? body.loreBefore : undefined,
            seedHistory:
              typeof body.seedHistory === "string"
                ? body.seedHistory
                : undefined,
            loreAfter:
              typeof body.loreAfter === "string" ? body.loreAfter : undefined,
            postTurn:
              typeof body.postTurn === "string" ? body.postTurn : undefined,
            presetId:
              body.presetId === null
                ? null
                : typeof body.presetId === "string"
                  ? body.presetId
                  : undefined,
          });
          json(res, 200, { shell });
        } catch (err) {
          json(res, 404, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return true;
      }

      if (req.method === "DELETE" && sub === "") {
        try {
          deleteShell(shellId);
          json(res, 200, { ok: true });
        } catch (err) {
          json(res, 404, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return true;
      }

      if (req.method === "GET" && sub === "/conversations") {
        if (!getShell(shellId)) {
          json(res, 404, { error: "上下文壳不存在" });
          return true;
        }
        json(res, 200, { conversations: listConversations(shellId) });
        return true;
      }

      if (req.method === "POST" && sub === "/conversations") {
        const body = JSON.parse(await readBody(req)) as {
          name?: string;
          messages?: DirectChatMessage[];
        };
        try {
          const conversation = createConversation({
            shellId,
            name: body.name,
            messages: body.messages,
          });
          json(res, 201, { conversation });
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return true;
      }
    }

    const convMatch = pathname.match(
      /^\/api\/direct-chat\/conversations\/([^/]+)(\/.*)?$/,
    );
    if (convMatch) {
      const conversationId = decodeURIComponent(convMatch[1]!);
      const sub = convMatch[2] ?? "";

      if (req.method === "GET" && sub === "") {
        const conversation = getConversation(conversationId);
        if (!conversation) {
          json(res, 404, { error: "会话不存在" });
          return true;
        }
        const shell = getShell(conversation.shellId);
        json(res, 200, { conversation, shell });
        return true;
      }

      if (
        (req.method === "PATCH" || req.method === "PUT") &&
        sub === ""
      ) {
        const body = JSON.parse(await readBody(req)) as {
          name?: string;
          messages?: DirectChatMessage[];
        };
        try {
          const conversation = updateConversation(conversationId, {
            name: body.name,
            messages: body.messages,
          });
          json(res, 200, { conversation });
        } catch (err) {
          json(res, 404, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return true;
      }

      if (req.method === "DELETE" && sub === "") {
        try {
          deleteConversation(conversationId);
          json(res, 200, { ok: true });
        } catch (err) {
          json(res, 404, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return true;
      }

      if (req.method === "POST" && sub === "/messages") {
        const body = JSON.parse(await readBody(req)) as {
          text?: string;
          windows?: DirectChatWindow[];
          complete?: boolean;
        };
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) {
          json(res, 400, { error: "text 不能为空" });
          return true;
        }
        const conversation = getConversation(conversationId);
        if (!conversation) {
          json(res, 404, { error: "会话不存在" });
          return true;
        }
        const shell = getShell(conversation.shellId);
        if (!shell) {
          json(res, 404, { error: "上下文壳不存在" });
          return true;
        }
        const windows =
          Array.isArray(body.windows) && body.windows.length
            ? body.windows
            : conversation.windows;
        if (!windows.length) {
          json(res, 400, { error: "请先新增至少一个模型窗口" });
          return true;
        }
        const turnId = randomUUID();
        const saver = createStreamingSaver(conversation, windows, text, turnId);
        const run = (hooks?: MultiStreamHooks) =>
          runDirectChatMultiTurn({
            message: text,
            slots: {
              systemPrompt: shell.systemPrompt,
              loreBefore: shell.loreBefore,
              seedHistory: shell.seedHistory,
              loreAfter: shell.loreAfter,
              postTurn: shell.postTurn,
            },
            presetId: shell.presetId,
            windows,
            turns: conversation.turns,
            complete: body.complete,
            turnId,
            onDelta: (event) => {
              saver.onDelta(event);
              hooks?.onDelta(event);
            },
            onWindow: (result) => {
              saver.onWindow(result);
              hooks?.onWindow(result);
            },
          });
        try {
          if (wantsNdjson(req)) {
            await writeMultiStream(res, run, (multi) => {
              saver.close();
              const updated = saveConversation({
                ...conversation,
                windows,
                turns: [
                  ...conversation.turns.filter((t) => t.id !== multi.turn.id),
                  multi.turn,
                ],
              });
              return { conversation: updated, shell };
            });
            return true;
          }
          const multi = await run();
          saver.close();
          const updated = saveConversation({
            ...conversation,
            windows,
            turns: [
              ...conversation.turns.filter((t) => t.id !== multi.turn.id),
              multi.turn,
            ],
          });
          json(res, 200, {
            conversation: updated,
            shell,
            multi,
          });
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return true;
      }

      const selectMatch = sub.match(/^\/turns\/([^/]+)\/select$/);
      if (selectMatch && req.method === "POST") {
        const turnId = decodeURIComponent(selectMatch[1]!);
        const body = JSON.parse(await readBody(req)) as {
          windowId?: string | null;
        };
        const conversation = getConversation(conversationId);
        if (!conversation) {
          json(res, 404, { error: "会话不存在" });
          return true;
        }
        const windowId =
          body.windowId === null || body.windowId === undefined
            ? null
            : String(body.windowId).trim() || null;
        if (windowId) {
          const turn = conversation.turns.find((t) => t.id === turnId);
          if (!turn?.replies.some((r) => r.windowId === windowId)) {
            json(res, 400, { error: "该窗口没有本轮回复" });
            return true;
          }
        }
        const turns = conversation.turns.map((t) =>
          t.id === turnId ? { ...t, selectedWindowId: windowId } : t,
        );
        const updated = saveConversation({ ...conversation, turns });
        json(res, 200, { conversation: updated });
        return true;
      }
    }

    if (
      req.method === "POST" &&
      pathname === "/api/direct-chat/ephemeral/complete"
    ) {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown> & {
        text?: string;
        complete?: boolean;
        presetId?: string | null;
        windows?: DirectChatWindow[];
        turns?: DirectChatTurn[];
      };
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) {
        json(res, 400, { error: "text 不能为空" });
        return true;
      }
      const windows = Array.isArray(body.windows) ? body.windows : [];
      const turns = Array.isArray(body.turns) ? body.turns : [];
      if (!windows.length) {
        json(res, 400, { error: "请先新增至少一个模型窗口" });
        return true;
      }
      const run = (hooks?: MultiStreamHooks) =>
        runDirectChatMultiTurn({
          message: text,
          slots: slotsFromBody(body),
          presetId:
            body.presetId === null
              ? null
              : typeof body.presetId === "string"
                ? body.presetId
                : undefined,
          windows,
          turns,
          complete: body.complete,
          onDelta: hooks?.onDelta,
          onWindow: hooks?.onWindow,
        });
      try {
        if (wantsNdjson(req)) {
          await writeMultiStream(res, run, () => ({}));
          return true;
        }
        const multi = await run();
        json(res, 200, { multi });
      } catch (err) {
        json(res, 400, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    if (req.method === "POST" && pathname === "/api/direct-chat/promote") {
      const body = JSON.parse(await readBody(req)) as {
        shellId?: string;
        shell?: {
          name?: string;
          systemPrompt?: string;
          loreBefore?: string;
          seedHistory?: string;
          loreAfter?: string;
          postTurn?: string;
          presetId?: string | null;
        };
        conversationName?: string;
        messages?: DirectChatMessage[];
        windows?: DirectChatWindow[];
        turns?: DirectChatTurn[];
      };
      try {
        const promoted = promoteTemporary({
          shellId: body.shellId,
          shell: body.shell
            ? {
                name: body.shell.name,
                slots: {
                  systemPrompt: body.shell.systemPrompt ?? "",
                  loreBefore: body.shell.loreBefore ?? "",
                  seedHistory: body.shell.seedHistory ?? "",
                  loreAfter: body.shell.loreAfter ?? "",
                  postTurn: body.shell.postTurn ?? "",
                },
                presetId: body.shell.presetId,
              }
            : undefined,
          conversationName: body.conversationName,
          messages: Array.isArray(body.messages) ? body.messages : [],
          windows: Array.isArray(body.windows) ? body.windows : [],
          turns: Array.isArray(body.turns) ? body.turns : [],
        });
        json(res, 201, promoted);
      } catch (err) {
        json(res, 400, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    if (
      req.method === "GET" &&
      pathname === "/api/direct-chat/compare-profiles"
    ) {
      json(res, 200, { profiles: listProfilesForCompare() });
      return true;
    }

    return false;
  } catch (err) {
    json(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}
