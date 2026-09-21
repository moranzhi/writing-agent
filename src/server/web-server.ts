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
  const headers: Record<string, string> = {
    "Content-Type": types[ext] ?? "application/octet-stream",
  };
  // 开发期：避免 ES module（agent-ui.js 等）被强缓存，改完 import 仍吃旧脚本导致主区空白
  if (ext === ".html" || ext === ".js" || ext === ".css") {
    headers["Cache-Control"] = "no-cache, must-revalidate";
  }
  res.writeHead(200, headers);
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
          "GET /api/stats/pricing",
          "POST /api/stats/pricing/sources",
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

      if (req.method === "GET" && sub === "/step-artifact") {
        try {
          const stepId = url.searchParams.get("stepId") ?? "";
          const data = await sessionManager.getStepArtifact(sessionId, stepId);
          json(res, 200, data);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "读取失败";
          json(res, msg.includes("不存在") ? 404 : 400, { error: msg });
        }
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

      if (req.method === "POST" && sub === "/dictate/clear-dialogue") {
        try {
          const view = await sessionManager.clearDictateDialogue(sessionId);
          json(res, 200, view);
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "清空失败",
          });
        }
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
        /^\/messages\/([^/]+)\/(edit|refresh|variant|delete|restart|compare)$/,
      );
      if (req.method === "POST" && messageActionMatch) {
        const messageId = decodeURIComponent(messageActionMatch[1]);
        const action = messageActionMatch[2];
        const body = JSON.parse(await readBody(req).catch(() => "{}")) as {
          text?: string;
          direction?: string;
          profileIds?: string[];
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
          } else if (action === "restart") {
            view = await sessionManager.restartFromMessage(sessionId, messageId);
          } else if (action === "compare") {
            const profileIds = Array.isArray(body.profileIds)
              ? body.profileIds.filter((x): x is string => typeof x === "string")
              : [];
            const job = await sessionManager.startModelCompare(
              sessionId,
              messageId,
              profileIds,
            );
            json(res, 200, job);
            return;
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

      const compareJobMatch = sub.match(/^\/compare\/([^/]+)(?:\/(adopt))?$/);
      if (compareJobMatch) {
        const jobId = decodeURIComponent(compareJobMatch[1]);
        const adopt = compareJobMatch[2] === "adopt";
        try {
          if (req.method === "GET" && !adopt) {
            json(res, 200, sessionManager.getModelCompare(sessionId, jobId));
            return;
          }
          if (req.method === "POST" && adopt) {
            const body = JSON.parse(await readBody(req).catch(() => "{}")) as {
              profileId?: string;
            };
            if (!body.profileId?.trim()) {
              json(res, 400, { error: "缺少 profileId" });
              return;
            }
            const view = await sessionManager.adoptModelCompare(
              sessionId,
              jobId,
              body.profileId.trim(),
            );
            json(res, 200, view);
            return;
          }
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "对比操作失败",
          });
          return;
        }
      }

      if (req.method === "POST" && sub === "/lifecycle") {
        const body = JSON.parse(await readBody(req)) as {
          stage?: string;
          useOpeningPersona?: boolean;
        };
        if (body.stage !== "design" && body.stage !== "play") {
          json(res, 400, { error: "stage 须为 design 或 play" });
          return;
        }
        try {
          const view = sessionManager.setLifecycleStage(sessionId, body.stage, {
            useOpeningPersona:
              typeof body.useOpeningPersona === "boolean"
                ? body.useOpeningPersona
                : undefined,
          });
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

      if (req.method === "POST" && sub === "/table") {
        const body = JSON.parse(await readBody(req)) as {
          tag?: string;
          cells?: Array<{ key?: string; value?: unknown; expectedRev?: number }>;
        };
        const cells = Array.isArray(body.cells)
          ? body.cells
              .filter(
                (c) =>
                  typeof c?.key === "string" &&
                  c.key.trim() &&
                  typeof c.expectedRev === "number",
              )
              .map((c) => ({
                key: String(c.key).trim(),
                value: c.value,
                expectedRev: c.expectedRev as number,
              }))
          : [];
        if (!cells.length) {
          json(res, 400, { error: "缺少 cells（每格需要 key 与 expectedRev）" });
          return;
        }
        try {
          const view = sessionManager.patchPlayTable(
            sessionId,
            body.tag?.trim() || "变量.当前",
            cells,
          );
          json(res, 200, view);
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "表写入失败",
          });
        }
        return;
      }

      if (req.method === "POST" && sub === "/play/opening") {
        const body = JSON.parse(await readBody(req)) as {
          index?: number;
          usePersona?: boolean;
        };
        if (typeof body.index !== "number" || !Number.isFinite(body.index)) {
          json(res, 400, { error: "缺少 index" });
          return;
        }
        try {
          const view = sessionManager.selectPlayOpening(
            sessionId,
            body.index,
            typeof body.usePersona === "boolean" ? body.usePersona : undefined,
          );
          json(res, 200, view);
        } catch (err) {
          json(res, 400, {
            error: err instanceof Error ? err.message : "无法选用开场",
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
          reason?: string;
          stepId?: string;
          moduleName?: string;
          reenter?: boolean;
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
          case "replan":
            view = await sessionManager.replan(
              sessionId,
              typeof body.reason === "string" ? body.reason : undefined,
            );
            break;
          case "leave_step":
            view = await sessionManager.leaveStep(sessionId);
            break;
          case "pick_step":
            view = await sessionManager.pickStep(
              sessionId,
              typeof body.stepId === "string" ? body.stepId : "",
              body.stepParams && typeof body.stepParams === "object"
                ? body.stepParams
                : undefined,
              body.reenter === true,
            );
            break;
          case "spawn_step":
            view = await sessionManager.spawnStep(
              sessionId,
              typeof body.moduleName === "string" ? body.moduleName : "",
            );
            break;
          case "delete_step":
            view = await sessionManager.deleteStep(
              sessionId,
              typeof body.stepId === "string" ? body.stepId : "",
            );
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
          case "abort_run":
            view = await sessionManager.abortRun(sessionId);
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
