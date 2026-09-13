/**
 * 用户角色（persona）：全局列表 + 当前选中，供 @玩家 / 预设人设洞使用。
 * 创作阶段用「创作默认」人设（建议名为 @玩家）；游玩用当前选用。
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureUserDataDirs, getUserDataDir } from "../config/user-data-dir.js";

/** 创作期用户角色名：替换后仍是占位，进游玩再换成当前选用。 */
export const CREATION_PLACEHOLDER_NAME = "@玩家";

export type UserPersona = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonaDirective = {
  name: string;
  description: string;
};

export type PersonaStoreFile = {
  version: 1;
  activeId: string | null;
  /** 创作阶段填预设用户设定洞；建议对应名为 @玩家 的角色 */
  creationDefaultId: string | null;
  personas: UserPersona[];
};

const FILE_NAME = "personas.json";

function storePath(): string {
  return path.join(getUserDataDir(), FILE_NAME);
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultStore(): PersonaStoreFile {
  const playId = randomUUID();
  const designId = randomUUID();
  const t = nowIso();
  return {
    version: 1,
    activeId: playId,
    creationDefaultId: designId,
    personas: [
      {
        id: playId,
        name: "玩家",
        description: "",
        createdAt: t,
        updatedAt: t,
      },
      {
        id: designId,
        name: CREATION_PLACEHOLDER_NAME,
        description: "",
        createdAt: t,
        updatedAt: t,
      },
    ],
  };
}

function toDirective(p: UserPersona): PersonaDirective {
  return { name: p.name, description: p.description };
}

function normalizeStore(raw: unknown): PersonaStoreFile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultStore();
  }
  const row = raw as Record<string, unknown>;
  if (row.version !== 1 || !Array.isArray(row.personas)) {
    return defaultStore();
  }
  const personas: UserPersona[] = [];
  for (const item of row.personas) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const p = item as Record<string, unknown>;
    const id = typeof p.id === "string" ? p.id.trim() : "";
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (!id || !name) continue;
    personas.push({
      id,
      name,
      description: typeof p.description === "string" ? p.description : "",
      createdAt: typeof p.createdAt === "string" ? p.createdAt : nowIso(),
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : nowIso(),
    });
  }
  if (!personas.length) return defaultStore();
  let activeId =
    typeof row.activeId === "string" && row.activeId.trim()
      ? row.activeId.trim()
      : null;
  if (!activeId || !personas.some((p) => p.id === activeId)) {
    activeId = personas[0]!.id;
  }

  const hasCreationDefaultKey = Object.prototype.hasOwnProperty.call(
    row,
    "creationDefaultId",
  );
  let creationDefaultId: string | null = null;
  if (hasCreationDefaultKey) {
    const rawId =
      typeof row.creationDefaultId === "string"
        ? row.creationDefaultId.trim()
        : "";
    creationDefaultId =
      rawId && personas.some((p) => p.id === rawId) ? rawId : null;
  } else {
    const named = personas.find((p) => p.name === CREATION_PLACEHOLDER_NAME);
    creationDefaultId = named?.id ?? null;
  }

  return { version: 1, activeId, creationDefaultId, personas };
}

export function loadPersonaStore(): PersonaStoreFile {
  ensureUserDataDirs();
  const file = storePath();
  if (!existsSync(file)) {
    const created = defaultStore();
    writeFileSync(file, JSON.stringify(created, null, 2), "utf8");
    return created;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return normalizeStore(parsed);
  } catch {
    return defaultStore();
  }
}

export function savePersonaStore(store: PersonaStoreFile): void {
  ensureUserDataDirs();
  writeFileSync(storePath(), JSON.stringify(store, null, 2), "utf8");
}

export function listPersonas(): UserPersona[] {
  return loadPersonaStore().personas;
}

export function getActivePersona(): UserPersona | null {
  const store = loadPersonaStore();
  if (!store.activeId) return store.personas[0] ?? null;
  return store.personas.find((p) => p.id === store.activeId) ?? store.personas[0] ?? null;
}

export function getCreationDefaultPersona(): UserPersona | null {
  const store = loadPersonaStore();
  if (!store.creationDefaultId) return null;
  return store.personas.find((p) => p.id === store.creationDefaultId) ?? null;
}

export function setActivePersonaId(id: string): UserPersona {
  const store = loadPersonaStore();
  const found = store.personas.find((p) => p.id === id);
  if (!found) throw new Error("用户角色不存在");
  store.activeId = id;
  savePersonaStore(store);
  return found;
}

export function setCreationDefaultPersonaId(id: string | null): UserPersona | null {
  const store = loadPersonaStore();
  if (id === null) {
    store.creationDefaultId = null;
    savePersonaStore(store);
    return null;
  }
  const found = store.personas.find((p) => p.id === id);
  if (!found) throw new Error("用户角色不存在");
  store.creationDefaultId = id;
  savePersonaStore(store);
  return found;
}

function applyCreationDefaultFlag(
  store: PersonaStoreFile,
  id: string,
  flag: boolean | undefined,
  name: string,
): void {
  if (flag === true) {
    store.creationDefaultId = id;
    return;
  }
  if (flag === false && store.creationDefaultId === id) {
    store.creationDefaultId = null;
    return;
  }
  if (
    flag === undefined &&
    !store.creationDefaultId &&
    name === CREATION_PLACEHOLDER_NAME
  ) {
    store.creationDefaultId = id;
  }
}

export function createPersona(input: {
  name: string;
  description?: string;
  activate?: boolean;
  creationDefault?: boolean;
}): UserPersona {
  const name = input.name.trim();
  if (!name) throw new Error("名称不能为空");
  const store = loadPersonaStore();
  const t = nowIso();
  const persona: UserPersona = {
    id: randomUUID(),
    name,
    description: (input.description ?? "").trim(),
    createdAt: t,
    updatedAt: t,
  };
  store.personas.push(persona);
  if (input.activate !== false) store.activeId = persona.id;
  applyCreationDefaultFlag(store, persona.id, input.creationDefault, name);
  savePersonaStore(store);
  return persona;
}

export function updatePersona(
  id: string,
  patch: { name?: string; description?: string; creationDefault?: boolean },
): UserPersona {
  const store = loadPersonaStore();
  const idx = store.personas.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error("用户角色不存在");
  const cur = store.personas[idx]!;
  const name =
    patch.name !== undefined ? patch.name.trim() : cur.name;
  if (!name) throw new Error("名称不能为空");
  const next: UserPersona = {
    ...cur,
    name,
    description:
      patch.description !== undefined
        ? patch.description
        : cur.description,
    updatedAt: nowIso(),
  };
  store.personas[idx] = next;
  applyCreationDefaultFlag(store, id, patch.creationDefault, name);
  savePersonaStore(store);
  return next;
}

export function deletePersona(id: string): void {
  const store = loadPersonaStore();
  if (store.personas.length <= 1) {
    throw new Error("至少保留一个用户角色");
  }
  const next = store.personas.filter((p) => p.id !== id);
  if (next.length === store.personas.length) {
    throw new Error("用户角色不存在");
  }
  store.personas = next;
  if (store.activeId === id) {
    store.activeId = next[0]!.id;
  }
  if (store.creationDefaultId === id) {
    const named = next.find((p) => p.name === CREATION_PLACEHOLDER_NAME);
    store.creationDefaultId = named?.id ?? null;
  }
  savePersonaStore(store);
}

export function personaDirectiveContext(): PersonaDirective | null {
  const p = getActivePersona();
  if (!p) return null;
  return toDirective(p);
}

/**
 * 创作：用创作默认人设（缺则名字退回 @玩家，替换仍是占位）。
 * 游玩：用当前选用。
 */
export function personaForLifecycle(
  stage: "design" | "play",
): PersonaDirective | null {
  if (stage === "design") {
    const designated = getCreationDefaultPersona();
    if (designated) return toDirective(designated);
    return { name: CREATION_PLACEHOLDER_NAME, description: "" };
  }
  return personaDirectiveContext();
}
