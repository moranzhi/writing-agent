import { listSkills } from "../skills/loader.js";
import type { SkillPackInfo } from "../types/book.js";

/** @deprecated 使用 listSkillPacks；保留兼容旧 import */
export async function listOrchestrators(): Promise<SkillPackInfo[]> {
  return listSkillPacks();
}

export async function listSkillPacks(): Promise<SkillPackInfo[]> {
  const skills = await listSkills();
  return skills.map((s) => ({
    id: s.name,
    name: s.name,
    description: s.description,
    category: s.category,
    bookKind: s.bookKind,
  }));
}

export async function getSkillPack(id: string): Promise<SkillPackInfo | null> {
  const all = await listSkillPacks();
  return all.find((o) => o.id === id) ?? null;
}

/** @deprecated */
export async function getOrchestrator(id: string): Promise<SkillPackInfo | null> {
  return getSkillPack(id);
}
