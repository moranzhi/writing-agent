import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../config/env.js";
import { sessionManager } from "./session-manager.js";
import { handleSettingsApi } from "./settings-handlers.js";
import { handleBooksApi } from "./book-handlers.js";
import { handleStatsApi } from "./stats-handlers.js";
import { ensureConsoleUtf8, getRuntimeLogPath } from "../log.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
ensureConsoleUtf8();
loadDotEnv(PROJECT_ROOT);
const WEB_ROOT = path.resolve(__dirname, "../../web");
const PORT = Number(process.env.PORT ?? 23337);

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

async function serveStatic(res: ServerResponse, filePath: string): Promise<void> {
  const ext = path.extname(filePath);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
  };
  const content = await readFile(filePath);
  res.writeHead(200, { "Content-Type": types[ext] ?? "application/octet-stream" });
  res.end(content);
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        version: "0.1.0",
        routes: [
          "GET /api/health",
          "GET /api/settings",
          "GET /api/profiles",
          "POST /api/profiles",
          "GET /api/presets",
          "GET /api/books",
          "GET /api/skills",
          "GET /api/directors",
          "GET /api/modules",
          "GET /api/stats/tokens",
        ],
      });
      return;
    }

    if (await handleSettingsApi(req, res, url.pathname)) {
      return;
    }

    if (await handleBooksApi(req, res, url.pathname)) {
      return;
    }

    if (await handleStatsApi(req, res, url.pathname, url.searchParams)) {
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sessions") {
      const body = await readBody(req).catch(() => "");
      let bookId: string | undefined;
      let orchestratorId: string | undefined;
      if (body) {
        try {
          const parsed = JSON.parse(body) as {
            bookId?: string;
            orchestratorId?: string;
          };
          bookId = parsed.bookId;
          orchestratorId = parsed.orchestratorId;
        } catch {
          /* empty body ok */
        }
      }
      const view = await sessionManager.createForBook(bookId, orchestratorId);
      json(res, 201, view);
      return;
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(\/.*)?$/);
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      const sub = sessionMatch[2] ?? "";

      if (req.method === "GET" && sub === "") {
        const view = sessionManager.get(sessionId);
        if (!view) {
          json(res, 404, { error: "会话不存在" });
          return;
        }
        json(res, 200, view);
        return;
      }

      if (req.method === "POST" && sub === "/messages") {
        const body = JSON.parse(await readBody(req)) as {
          text?: string;
          answers?: Array<{
            questionId?: string;
            optionId?: string;
            text?: string;
          }>;
        };
        const text = typeof body.text === "string" ? body.text : "";
        const trimmed = text.trim();
        const answers = (body.answers ?? [])
          .filter(
            (a) =>
              typeof a?.questionId === "string" &&
              a.questionId.trim() &&
              typeof a?.text === "string" &&
              a.text.trim(),
          )
          .map((a) => ({
            questionId: a.questionId!.trim(),
            optionId:
              typeof a.optionId === "string" && a.optionId.trim()
                ? a.optionId.trim()
                : undefined,
            text: a.text!.trim(),
          }));
        // next_intent 明确可留空；其余态仍要求有字（除非顺带提交了追问）
        if (!trimmed && !answers.length) {
          const current = sessionManager.get(sessionId);
          if (current?.waitingReason?.kind !== "next_intent") {
            json(res, 400, { error: "text 不能为空" });
            return;
          }
        }
        const view = await sessionManager.sendMessage(
          sessionId,
          trimmed,
          answers.length ? { answers } : undefined,
        );
        json(res, 200, view);
        return;
      }

      if (req.method === "POST" && sub === "/answers") {
        const body = JSON.parse(await readBody(req)) as {
          answers?: Array<{
            questionId?: string;
            optionId?: string;
            text?: string;
          }>;
          note?: string;
        };
        const answers = (body.answers ?? [])
          .filter(
            (a) =>
              typeof a?.questionId === "string" &&
              a.questionId.trim() &&
              typeof a?.text === "string" &&
              a.text.trim(),
          )
          .map((a) => ({
            questionId: a.questionId!.trim(),
            optionId:
              typeof a.optionId === "string" && a.optionId.trim()
                ? a.optionId.trim()
                : undefined,
            text: a.text!.trim(),
          }));
        if (!answers.length) {
          json(res, 400, { error: "answers 不能为空" });
          return;
        }
        const note =
          typeof body.note === "string" && body.note.trim()
            ? body.note.trim()
            : undefined;
        try {
          const view = await sessionManager.answerQuestions(
            sessionId,
            answers,
            note,
          );
          json(res, 200, view);
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "提交失败",
          });
        }
        return;
      }

      const messageActionMatch = sub.match(
        /^\/messages\/([^/]+)\/(edit|refresh|variant|delete)$/,
      );
      if (req.method === "POST" && messageActionMatch) {
        const messageId = decodeURIComponent(messageActionMatch[1]);
        const action = messageActionMatch[2];
        const body = JSON.parse(await readBody(req).catch(() => "{}")) as {
          text?: string;
          direction?: string;
        };
        let view;
        try {
          if (action === "edit") {
            if (!body.text?.trim()) {
              json(res, 400, { error: "text 不能为空" });
              return;
            }
            view = await sessionManager.editMessage(
              sessionId,
              messageId,
              body.text.trim(),
            );
          } else if (action === "refresh") {
            view = await sessionManager.refreshMessage(sessionId, messageId);
          } else if (action === "variant") {
            if (body.direction !== "prev" && body.direction !== "next") {
              json(res, 400, { error: "direction 须为 prev 或 next" });
              return;
            }
            view = await sessionManager.switchMessageVariant(
              sessionId,
              messageId,
              body.direction,
            );
          } else if (action === "delete") {
            view = await sessionManager.deleteMessage(sessionId, messageId);
          } else {
            json(res, 400, { error: "未知 action" });
            return;
          }
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "操作失败",
          });
          return;
        }
        json(res, 200, view);
        return;
      }

      if (req.method === "POST" && sub === "/lifecycle") {
        const body = JSON.parse(await readBody(req)) as { stage?: string };
        if (body.stage !== "design" && body.stage !== "play") {
          json(res, 400, { error: "stage 须为 design 或 play" });
          return;
        }
        try {
          const view = sessionManager.setLifecycleStage(sessionId, body.stage);
          json(res, 200, view);
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "无法切换模式",
          });
        }
        return;
      }

      if (req.method === "POST" && sub === "/recipe") {
        const body = JSON.parse(await readBody(req)) as { recipeId?: string };
        if (!body.recipeId?.trim()) {
          json(res, 400, { error: "缺少 recipeId" });
          return;
        }
        try {
          const view = await sessionManager.setSelectedRecipe(
            sessionId,
            body.recipeId.trim(),
          );
          json(res, 200, view);
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "选定配方失败",
          });
        }
        return;
      }

      if (req.method === "POST" && sub === "/board") {
        const body = JSON.parse(await readBody(req)) as {
          tag?: string;
          content?: string;
        };
        if (!body.tag?.trim()) {
          json(res, 400, { error: "缺少 tag" });
          return;
        }
        try {
          const view = sessionManager.writeUserBoardTag(
            sessionId,
            body.tag,
            body.content ?? "",
          );
          json(res, 200, view);
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "写入失败",
          });
        }
        return;
      }

      if (req.method === "POST" && sub === "/context-order") {
        const body = JSON.parse(await readBody(req)) as {
          action?: string;
          slotRef?: string;
          index?: number;
          delta?: number;
          anchor?: string;
          projection?: string;
          context_order?: unknown;
        };
        try {
          const action = body.action?.trim();
          if (action === "replace") {
            const view = sessionManager.patchContextOrder(sessionId, {
              action: "replace",
              context_order: body.context_order,
            });
            json(res, 200, view);
            return;
          }
          if (action === "move") {
            const delta = body.delta === 1 || body.delta === -1 ? body.delta : 0;
            if (!body.slotRef?.trim() || typeof body.index !== "number" || !delta) {
              json(res, 400, { error: "move 需要 slotRef、index、delta(±1)" });
              return;
            }
            const view = sessionManager.patchContextOrder(sessionId, {
              action: "move",
              slotRef: body.slotRef.trim(),
              index: body.index,
              delta,
            });
            json(res, 200, view);
            return;
          }
          if (action === "set_anchor") {
            if (
              !body.slotRef?.trim() ||
              typeof body.index !== "number" ||
              (body.anchor !== "pre_history" && body.anchor !== "post_history")
            ) {
              json(res, 400, {
                error: "set_anchor 需要 slotRef、index、anchor(pre_history|post_history)",
              });
              return;
            }
            const view = sessionManager.patchContextOrder(sessionId, {
              action: "set_anchor",
              slotRef: body.slotRef.trim(),
              index: body.index,
              anchor: body.anchor,
            });
            json(res, 200, view);
            return;
          }
          if (action === "set_projection") {
            const proj = body.projection;
            if (
              !body.slotRef?.trim() ||
              typeof body.index !== "number" ||
              (proj !== "fixed" &&
                proj !== "full" &&
                proj !== "summary" &&
                proj !== "fields")
            ) {
              json(res, 400, {
                error: "set_projection 需要 slotRef、index、projection",
              });
              return;
            }
            const view = sessionManager.patchContextOrder(sessionId, {
              action: "set_projection",
              slotRef: body.slotRef.trim(),
              index: body.index,
              projection: proj,
            });
            json(res, 200, view);
            return;
          }
          json(res, 400, {
            error: "action 须为 move | set_anchor | set_projection | replace",
          });
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "编排失败",
          });
        }
        return;
      }

      if (req.method === "POST" && sub === "/context-traces/prune") {
        try {
          const result = sessionManager.pruneSessionContextTraces(sessionId);
          json(res, 200, { ...result, session: sessionManager.get(sessionId) });
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "修剪失败",
          });
        }
        return;
      }

      if (req.method === "POST" && sub === "/context-traces/clear") {
        try {
          const result = sessionManager.clearSessionContextTraces(sessionId);
          json(res, 200, { ...result, session: sessionManager.get(sessionId) });
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "清除失败",
          });
        }
        return;
      }

      if (req.method === "POST" && sub === "/actions") {
        const body = JSON.parse(await readBody(req)) as {
          action?: string;
          stepParams?: Record<string, unknown>;
          openingIndex?: number;
        };
        let view;
        try {
          switch (body.action) {
          case "approve":
            view = await sessionManager.approve(
              sessionId,
              body.stepParams && typeof body.stepParams === "object"
                ? body.stepParams
                : undefined,
            );
            break;
          case "confirm_intake":
            view = await sessionManager.confirmIntake(sessionId);
            break;
          case "accept":
            view = await sessionManager.accept(
              sessionId,
              typeof body.openingIndex === "number"
                ? { openingIndex: body.openingIndex }
                : undefined,
            );
            break;
          case "skip_questions":
            view = await sessionManager.skipQuestions(sessionId);
            break;
          case "reject":
            view = await sessionManager.reject(sessionId);
            break;
          case "run_outline":
            view = await sessionManager.runOutline(sessionId);
            break;
          case "finish":
            view = await sessionManager.finish(sessionId);
            break;
          case "retry_run":
            view = await sessionManager.abortAndRetry(sessionId);
            break;
          default:
            json(res, 400, { error: "未知 action" });
            return;
        }
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "操作失败",
          });
          return;
        }
        json(res, 200, view);
        return;
      }
    }

    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, "");
    const full = path.join(WEB_ROOT, safe);
    if (!full.startsWith(WEB_ROOT)) {
      json(res, 403, { error: "Forbidden" });
      return;
    }
    try {
      await serveStatic(res, full);
    } catch {
      json(res, 404, { error: "Not found" });
    }
  } catch (err) {
    console.error("[接口]", req.method, url.pathname, err);
    json(res, 500, {
      error: err instanceof Error ? err.message : "服务器错误",
    });
  }
});

server.listen(PORT, () => {
  console.log(`对话页  http://localhost:${PORT}`);
  console.log(`运行日志（UTF-8）  ${getRuntimeLogPath()}`);
});
