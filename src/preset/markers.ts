import type {
  PresetPackage,
  PresetPromptEntry,
  PresetPromptOrderItem,
  PresetPromptRole,
} from "../types/preset.js";

/** 酒馆角色卡 / WI marker：导入后保留位置；personaDescription 由当前用户角色填。 */
export const ST_UNFILLED_MARKERS = new Set([
  "worldInfoBefore",
  "charDescription",
  "charPersonality",
  "scenario",
  "worldInfoAfter",
  "dialogueExamples",
]);

export const PERSONA_DESCRIPTION_MARKER = "personaDescription";

export const CHAT_HISTORY_MARKER = "chatHistory";
export const WORLD_BOOK_BEFORE = "worldBookBefore";
export const WORLD_BOOK_AFTER = "worldBookAfter";
export const CURRENT_TURN = "currentTurn";
export const POST_TURN = "postTurn";

/** 导入时插入的自有洞（不含共用的 chatHistory）。 */
export const APP_INSERTED_MARKERS = [
  WORLD_BOOK_BEFORE,
  WORLD_BOOK_AFTER,
  CURRENT_TURN,
  POST_TURN,
] as const;

const APP_INSERTED_SET = new Set<string>(APP_INSERTED_MARKERS);

type MarkerDef = {
  id: string;
  name: string;
  role: PresetPromptRole;
};

const MARKER_DEFS: MarkerDef[] = [
  { id: WORLD_BOOK_BEFORE, name: "世界书（历史前）", role: "system" },
  { id: CHAT_HISTORY_MARKER, name: "对话历史", role: "system" },
  { id: WORLD_BOOK_AFTER, name: "世界书（历史后）", role: "system" },
  { id: CURRENT_TURN, name: "本轮对话", role: "user" },
  { id: POST_TURN, name: "本轮之后", role: "system" },
];

function upsertMarkerEntry(
  prompts: PresetPromptEntry[],
  def: MarkerDef,
): PresetPromptEntry[] {
  if (prompts.some((p) => p.id === def.id)) return prompts;
  return [
    ...prompts,
    {
      id: def.id,
      name: def.name,
      enabled: true,
      role: def.role,
      content: "",
      marker: true,
      sourceIdentifier: def.id,
    },
  ];
}

function reindex(
  order: Omit<PresetPromptOrderItem, "orderIndex">[],
): PresetPromptOrderItem[] {
  return order.map((item, orderIndex) => ({ ...item, orderIndex }));
}

/**
 * 以 chatHistory 为锚点插入四个自有 marker。
 * 可重复调用：先摘掉已插入的自有洞，再按规则放回。
 */
export function applyExtendedMarkers(preset: PresetPackage): PresetPackage {
  let prompts = [...preset.prompts];
  for (const def of MARKER_DEFS) {
    prompts = upsertMarkerEntry(prompts, def);
  }

  const rawOrder = [...preset.promptOrder]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .filter((item) => !APP_INSERTED_SET.has(item.promptId));

  const histIndex = rawOrder.findIndex(
    (item) => item.promptId === CHAT_HISTORY_MARKER,
  );

  const inserted = (id: string): PresetPromptOrderItem => ({
    promptId: id,
    enabled: true,
    orderIndex: 0,
  });

  let next: PresetPromptOrderItem[];
  if (histIndex < 0) {
    next = reindex([
      ...rawOrder,
      inserted(WORLD_BOOK_BEFORE),
      inserted(CHAT_HISTORY_MARKER),
      inserted(WORLD_BOOK_AFTER),
      inserted(CURRENT_TURN),
      inserted(POST_TURN),
    ]);
  } else {
    const before = rawOrder.slice(0, histIndex);
    const history = rawOrder[histIndex]!;
    const after = rawOrder.slice(histIndex + 1);
    next = reindex([
      ...before,
      inserted(WORLD_BOOK_BEFORE),
      history,
      inserted(WORLD_BOOK_AFTER),
      inserted(CURRENT_TURN),
      ...after,
      inserted(POST_TURN),
    ]);
  }

  return {
    ...preset,
    prompts,
    promptOrder: next,
  };
}

export function isStUnfilledMarker(identifier: string): boolean {
  return ST_UNFILLED_MARKERS.has(identifier);
}
