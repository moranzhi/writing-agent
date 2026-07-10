import type { BookProject } from "../types/book.js";
import type { PersistedBookSession } from "../types/book-session.js";
import type { RunSnapshot } from "../types/run-snapshot.js";
import type { RuntimeSession } from "../types/runtime.js";
import type { ActiveSkillSnapshot } from "../types/runtime.js";

/** 作品或快照绑定的 skill 包 id（兼容旧 orchestratorId 字段） */
export function bookSkillPackId(book: BookProject): string | undefined {
  return book.activeSkillId ?? book.orchestratorId;
}

export function sessionSkillPackId(session: RuntimeSession): string | undefined {
  const snap = session.slots.activeSkill as ActiveSkillSnapshot | undefined;
  return snap?.name;
}

export function persistedSkillPackId(snapshot: PersistedBookSession): string | undefined {
  return (
    sessionSkillPackId(snapshot.runtimeSession) ?? snapshot.orchestratorId ?? undefined
  );
}

export function runSnapshotSkillPackId(snapshot: RunSnapshot): string | undefined {
  return (
    sessionSkillPackId(snapshot.runtimeSession) ?? snapshot.orchestratorId ?? undefined
  );
}

export function skillPacksMatch(
  book: BookProject,
  snapshotSkill: string | undefined,
): boolean {
  const bookSkill = bookSkillPackId(book);
  if (!snapshotSkill) return true;
  if (!bookSkill) return true;
  return bookSkill === snapshotSkill;
}
