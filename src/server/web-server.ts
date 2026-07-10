import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../config/env.js";
import { sessionManager } from "./session-manager.js";
import { handleSettingsApi } from "./settings-handlers.js";
import { handleBooksApi } from "./book-handlers.js";
import { handleStatsApi } from "./stats-handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
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
        const body = JSON.parse(await readBody(req)) as { text?: string };
        if (!body.text?.trim()) {
          json(res, 400, { error: "text 不能为空" });
          return;
        }
        const view = await sessionManager.sendMessage(sessionId, body.text.trim());
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

      if (req.method === "POST" && sub === "/actions") {
        const body = JSON.parse(await readBody(req)) as { action?: string };
        let view;
        switch (body.action) {
          case "approve":
            view = await sessionManager.approve(sessionId);
            break;
          case "confirm_intake":
            view = await sessionManager.confirmIntake(sessionId);
            break;
          case "accept":
            view = await sessionManager.accept(sessionId);
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
          default:
            json(res, 400, { error: "未知 action" });
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
    console.error("[api]", req.method, url.pathname, err);
    json(res, 500, {
      error: err instanceof Error ? err.message : "服务器错误",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Writing Agent 对话页: http://localhost:${PORT}`);
});
