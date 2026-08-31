import type { IncomingMessage, ServerResponse } from "node:http";
import { listSkills } from "../skills/loader.js";
import { createBook, deleteBook, duplicateBook, getBook, listBooks, updateBook } from "../book/store.js";
import { sessionManager } from "./session-manager.js";

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

type ModuleStatus = "ready" | "partial" | "skeleton" | "missing";

function moduleStatusFromSections(
  hasPrompt: boolean,
  present: string[],
  taskBody?: string,
): ModuleStatus {
  if (!hasPrompt) return "missing";
  const hasTask = present.includes("task");
  const hasOutput = present.includes("output");
  if (!hasTask || !hasOutput) return "skeleton";
  const task = taskBody?.trim() ?? "";
  const stub =
    !task ||
    /待作者细写|待完善|（待/.test(task) ||
    task.length < 120;
  if (stub) return "skeleton";
  const depth = ["principles", "probe", "checklist", "examples"].filter((id) =>
    present.includes(id),
  ).length;
  return depth >= 2 ? "ready" : "partial";
}

async function loadModulesPayload(skillId: string): Promise<{
  skillPackId: string;
  modules: Array<{
    id: string;
    name: string;
    declaration: string;
    artifact: string;
    hasPrompt: boolean;
    sectionsPresent: string[];
    status: ModuleStatus;
  }>;
}> {
  const { loadSkill } = await import("../skills/loader.js");
  const {
    loadModuleCatalog,
    loadModulePrompt,
    parseModulePromptSections,
    MODULE_SECTION_IDS,
  } = await import("../skills/creation-flow.js");
  const skill = await loadSkill(skillId);
  if (!skill.skillPackRoot) {
    return { skillPackId: skillId, modules: [] };
  }
  const catalog = await loadModuleCatalog(skill.skillPackRoot);
  const modules = [];
  for (const m of catalog?.modules ?? []) {
    const prompt = await loadModulePrompt(skill.skillPackRoot, m.id);
    const sections = prompt
      ? parseModulePromptSections(prompt)
      : { raw: "", blocks: {} };
    const sectionsPresent = MODULE_SECTION_IDS.filter((id) =>
      Boolean(sections.blocks[id]?.trim()),
    );
    const hasPrompt = Boolean(prompt?.trim());
    const taskBody = sections.blocks.task?.trim();
    modules.push({
      id: m.id,
      name: m.name,
      declaration: m.declaration,
      artifact: m.artifact,
      hasPrompt,
      sectionsPresent: [...sectionsPresent],
      status: moduleStatusFromSections(hasPrompt, sectionsPresent, taskBody),
    });
  }
  return { skillPackId: skillId, modules };
}

async function loadModuleDetailPayload(
  skillId: string,
  moduleId: string,
): Promise<{
  skillPackId: string;
  id: string;
  name: string;
  declaration: string;
  artifact: string;
  hasPrompt: boolean;
  sectionsPresent: string[];
  status: ModuleStatus;
  sections: Record<string, string>;
  meta: Record<string, unknown> | null;
  raw: string;
} | null> {
  const { loadSkill } = await import("../skills/loader.js");
  const {
    loadModuleCatalog,
    loadModulePrompt,
    parseModulePromptSections,
    MODULE_SECTION_IDS,
  } = await import("../skills/creation-flow.js");
  const { parse: parseYaml } = await import("yaml");
  const skill = await loadSkill(skillId);
  if (!skill.skillPackRoot) return null;
  const catalog = await loadModuleCatalog(skill.skillPackRoot);
  const entry = catalog?.modules.find((m) => m.id === moduleId) ?? null;
  if (!entry) return null;
  const prompt = await loadModulePrompt(skill.skillPackRoot, moduleId);
  const parsed = prompt
    ? parseModulePromptSections(prompt)
    : { raw: "", blocks: {} };
  const sections: Record<string, string> = {};
  for (const id of MODULE_SECTION_IDS) {
    const body = parsed.blocks[id]?.trim();
    if (body) sections[id] = body;
  }
  const sectionsPresent = Object.keys(sections);
  const hasPrompt = Boolean(prompt?.trim());
  let meta: Record<string, unknown> | null = null;
  const metaRaw = sections.meta;
  if (metaRaw) {
    try {
      const doc = parseYaml(metaRaw);
      if (doc && typeof doc === "object" && !Array.isArray(doc)) {
        meta = doc as Record<string, unknown>;
      }
    } catch {
      meta = null;
    }
  }
  return {
    skillPackId: skillId,
    id: entry.id,
    name: entry.name,
    declaration: entry.declaration,
    artifact: entry.artifact,
    hasPrompt,
    sectionsPresent,
    status: moduleStatusFromSections(
      hasPrompt,
      sectionsPresent,
      sections.task,
    ),
    sections,
    meta,
    raw: prompt ?? "",
  };
}

export async function handleBooksApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === "/api/skills" && req.method === "GET") {
    const skills = await listSkills();
    json(res, 200, {
      skills: skills.map((s) => ({
        id: s.name,
        name: s.name,
        description: s.description,
        category: s.category,
        bookKind: s.bookKind,
      })),
    });
    return true;
  }

  /** 新建作品：配方一层选型（内部 = recipes catalog） */
  if (pathname === "/api/directors" && req.method === "GET") {
    const { DEFAULT_ORCHESTRATOR_ID } = await import(
      "../config/default-orchestrator.js"
    );
    const skillId = DEFAULT_ORCHESTRATOR_ID;
    try {
      const { loadSkill } = await import("../skills/loader.js");
      const { loadRecipeCatalog } = await import("../skills/creation-flow.js");
      const skill = await loadSkill(skillId);
      if (!skill.skillPackRoot) {
        json(res, 200, { directors: [], skillPackId: skillId });
        return true;
      }
      const catalog = await loadRecipeCatalog(skill.skillPackRoot);
      json(res, 200, {
        skillPackId: skillId,
        directors: (catalog?.recipes ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          declaration: r.declaration,
        })),
      });
    } catch (err) {
      json(res, 404, {
        error: err instanceof Error ? err.message : "未找到配方列表",
      });
    }
    return true;
  }

  const recipesMatch = pathname.match(/^\/api\/skills\/([^/]+)\/recipes$/);
  if (recipesMatch && req.method === "GET") {
    const skillId = decodeURIComponent(recipesMatch[1]);
    try {
      const { loadSkill } = await import("../skills/loader.js");
      const { loadRecipeCatalog } = await import("../skills/creation-flow.js");
      const skill = await loadSkill(skillId);
      if (!skill.skillPackRoot) {
        json(res, 200, { recipes: [] });
        return true;
      }
      const catalog = await loadRecipeCatalog(skill.skillPackRoot);
      json(res, 200, {
        recipes: (catalog?.recipes ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          declaration: r.declaration,
        })),
      });
    } catch (err) {
      json(res, 404, {
        error: err instanceof Error ? err.message : "未找到技能包",
      });
    }
    return true;
  }

  /** 默认配方包的技能池（编排备选） */
  if (pathname === "/api/modules" && req.method === "GET") {
    const { DEFAULT_ORCHESTRATOR_ID } = await import(
      "../config/default-orchestrator.js"
    );
    try {
      const payload = await loadModulesPayload(DEFAULT_ORCHESTRATOR_ID);
      json(res, 200, payload);
    } catch (err) {
      json(res, 404, {
        error: err instanceof Error ? err.message : "未找到能力目录",
      });
    }
    return true;
  }

  const moduleDetailMatch = pathname.match(/^\/api\/modules\/([^/]+)$/);
  if (moduleDetailMatch && req.method === "GET") {
    const { DEFAULT_ORCHESTRATOR_ID } = await import(
      "../config/default-orchestrator.js"
    );
    const moduleId = decodeURIComponent(moduleDetailMatch[1]);
    try {
      const detail = await loadModuleDetailPayload(
        DEFAULT_ORCHESTRATOR_ID,
        moduleId,
      );
      if (!detail) {
        json(res, 404, { error: `未找到能力：${moduleId}` });
        return true;
      }
      json(res, 200, detail);
    } catch (err) {
      json(res, 404, {
        error: err instanceof Error ? err.message : "未找到能力",
      });
    }
    return true;
  }

  const skillModulesMatch = pathname.match(
    /^\/api\/skills\/([^/]+)\/modules$/,
  );
  if (skillModulesMatch && req.method === "GET") {
    const skillId = decodeURIComponent(skillModulesMatch[1]);
    try {
      const payload = await loadModulesPayload(skillId);
      json(res, 200, payload);
    } catch (err) {
      json(res, 404, {
        error: err instanceof Error ? err.message : "未找到能力目录",
      });
    }
    return true;
  }

  const skillModuleDetailMatch = pathname.match(
    /^\/api\/skills\/([^/]+)\/modules\/([^/]+)$/,
  );
  if (skillModuleDetailMatch && req.method === "GET") {
    const skillId = decodeURIComponent(skillModuleDetailMatch[1]);
    const moduleId = decodeURIComponent(skillModuleDetailMatch[2]);
    try {
      const detail = await loadModuleDetailPayload(skillId, moduleId);
      if (!detail) {
        json(res, 404, { error: `未找到能力：${moduleId}` });
        return true;
      }
      json(res, 200, detail);
    } catch (err) {
      json(res, 404, {
        error: err instanceof Error ? err.message : "未找到能力",
      });
    }
    return true;
  }

  if (pathname === "/api/books" && req.method === "GET") {
    json(res, 200, { books: listBooks() });
    return true;
  }

  if (pathname === "/api/books" && req.method === "POST") {
    const body = JSON.parse(await readBody(req)) as {
      title?: string;
      /** 编排器包 id（registry name） */
      orchestratorId?: string;
      /** 用户手动选定的配方 id（内部 recipe） */
      recipeId?: string;
    };
    const skills = await listSkills();
    const requested = body.orchestratorId?.trim();
    const director =
      (requested && skills.find((s) => s.name === requested)) ||
      skills.find((s) => s.name === "world-simulator") ||
      skills[0];
    if (!director) {
      json(res, 400, { error: "没有可用的编排器技能包" });
      return true;
    }
    const book = createBook({ title: body.title });
    updateBook(book.id, {
      activeSkillId: director.name,
      activeSkillName: director.description?.split("\n")[0]?.slice(0, 80) || director.name,
      orchestratorId: director.name,
      orchestratorName: director.name,
    });
    const session = await sessionManager.createForBook(
      book.id,
      director.name,
      body.recipeId?.trim(),
    );
    json(res, 201, { book: getBook(book.id) ?? book, session });
    return true;
  }

  if (pathname === "/api/books/batch" && req.method === "DELETE") {
    const body = JSON.parse(await readBody(req)) as { ids?: string[] };
    const ids = (body.ids ?? []).filter(Boolean);
    const deleted: string[] = [];
    for (const id of ids) {
      const book = getBook(id);
      if (!book) continue;
      sessionManager.dropBookSessions(id);
      deleteBook(id);
      deleted.push(id);
    }
    json(res, 200, { deleted });
    return true;
  }

  const duplicateMatch = pathname.match(/^\/api\/books\/([^/]+)\/duplicate$/);
  if (duplicateMatch && req.method === "POST") {
    const bookId = decodeURIComponent(duplicateMatch[1]);
    const body = JSON.parse(await readBody(req)) as { title?: string };
    try {
      const book = duplicateBook(bookId, body.title);
      json(res, 201, { book });
    } catch (err) {
      json(res, 400, {
        error: err instanceof Error ? err.message : "复制失败",
      });
    }
    return true;
  }

  const playNewMatch = pathname.match(/^\/api\/books\/([^/]+)\/play\/new$/);
  if (playNewMatch && req.method === "POST") {
    const bookId = decodeURIComponent(playNewMatch[1]);
    const book = getBook(bookId);
    if (!book) {
      json(res, 404, { error: "Book 不存在" });
      return true;
    }
    const active = sessionManager.getActiveSessionForBook(bookId);
    if (!active?.id) {
      json(res, 400, { error: "请先打开该作品" });
      return true;
    }
    try {
      let instanceId: string | undefined;
      try {
        const raw = await readBody(req);
        if (raw.trim()) {
          const body = JSON.parse(raw) as { instanceId?: string };
          instanceId = body.instanceId?.trim() || undefined;
        }
      } catch {
        instanceId = undefined;
      }
      const session = await sessionManager.startNewPlayRun(active.id, instanceId);
      json(res, 200, { session });
    } catch (err) {
      json(res, 400, {
        error: err instanceof Error ? err.message : "无法新建游玩",
      });
    }
    return true;
  }

  const savesListMatch = pathname.match(/^\/api\/books\/([^/]+)\/saves$/);
  if (savesListMatch) {
    const bookId = decodeURIComponent(savesListMatch[1]);
    const book = getBook(bookId);
    if (!book) {
      json(res, 404, { error: "Book 不存在" });
      return true;
    }

    if (req.method === "GET") {
      try {
        const saves = sessionManager.listGameSnapshots(bookId).map((s) => ({
          ...s,
          kindLabel: s.kind === "instance" ? "创作定稿" : "游玩进度",
        }));
        json(res, 200, {
          saves,
          playWorkingInstanceId:
            sessionManager.playWorkingInstanceId(bookId) ?? null,
        });
      } catch (err) {
        json(res, 400, {
          error: err instanceof Error ? err.message : "读取存档失败",
        });
      }
      return true;
    }

    if (req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as {
        label?: string;
        note?: string;
        sessionId?: string;
        /** instance=创作定稿截面；run=游玩进度（默认） */
        kind?: "instance" | "run";
      };
      const sessionId =
        body.sessionId?.trim() ||
        sessionManager.getActiveSessionForBook(bookId)?.id;
      if (!sessionId) {
        json(res, 400, { error: "当前作品没有活跃会话，无法存档" });
        return true;
      }
      const kind = body.kind === "instance" ? "instance" : "run";
      try {
        const save =
          kind === "run"
            ? sessionManager.savePlaySnapshot(sessionId, body.label ?? "", body.note)
            : sessionManager.saveGameSnapshot(
                sessionId,
                body.label ?? "",
                "instance",
                body.note,
              );
        json(res, 201, {
          save: {
            ...save,
            kindLabel: save.kind === "instance" ? "创作定稿" : "游玩进度",
          },
        });
      } catch (err) {
        json(res, 400, {
          error: err instanceof Error ? err.message : "存档失败",
        });
      }
      return true;
    }
  }

  const saveItemMatch = pathname.match(
    /^\/api\/books\/([^/]+)\/saves\/([^/]+)(\/load)?$/,
  );
  if (saveItemMatch) {
    const bookId = decodeURIComponent(saveItemMatch[1]);
    const saveId = decodeURIComponent(saveItemMatch[2]);
    const isLoad = saveItemMatch[3] === "/load";

    if (isLoad && req.method === "POST") {
      try {
        const session = await sessionManager.loadGameSnapshot(bookId, saveId);
        json(res, 200, { session });
      } catch (err) {
        json(res, 400, {
          error: err instanceof Error ? err.message : "读档失败",
        });
      }
      return true;
    }

    if ((req.method === "PATCH" || req.method === "PUT") && !isLoad) {
      const body = JSON.parse(await readBody(req)) as { label?: string };
      try {
        const save = sessionManager.renameGameSnapshot(
          bookId,
          saveId,
          body.label ?? "",
        );
        json(res, 200, {
          save: {
            ...save,
            kindLabel: save.kind === "instance" ? "创作定稿" : "游玩进度",
          },
        });
      } catch (err) {
        json(res, 400, {
          error: err instanceof Error ? err.message : "重命名失败",
        });
      }
      return true;
    }

    if (req.method === "DELETE") {
      try {
        sessionManager.deleteGameSnapshot(bookId, saveId);
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 404, {
          error: err instanceof Error ? err.message : "删除失败",
        });
      }
      return true;
    }
  }

  const bookMatch = pathname.match(/^\/api\/books\/([^/]+)(\/open)?$/);
  if (bookMatch) {
    const bookId = decodeURIComponent(bookMatch[1]);
    const isOpen = bookMatch[2] === "/open";

    if (isOpen && req.method === "POST") {
      const book = getBook(bookId);
      if (!book) {
        json(res, 404, { error: "Book 不存在" });
        return true;
      }
      const session = await sessionManager.openBook(book.id);
      json(res, 200, { book, session });
      return true;
    }

    if (req.method === "GET") {
      const book = getBook(bookId);
      if (!book) {
        json(res, 404, { error: "Book 不存在" });
        return true;
      }
      json(res, 200, { book });
      return true;
    }

    if (req.method === "PUT") {
      const body = JSON.parse(await readBody(req)) as { title?: string };
      try {
        const book = updateBook(bookId, { title: body.title?.trim() });
        json(res, 200, { book });
      } catch (err) {
        json(res, 404, {
          error: err instanceof Error ? err.message : "更新失败",
        });
      }
      return true;
    }

    if (req.method === "DELETE") {
      const book = getBook(bookId);
      if (!book) {
        json(res, 404, { error: "Book 不存在" });
        return true;
      }
      sessionManager.dropBookSessions(bookId);
      deleteBook(bookId);
      json(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}
