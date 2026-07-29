import type { SkillIndexEntry, SkillStartupMode, ActiveSkillSnapshot } from "../types/runtime.js";

/** 新建作品时自动加载的能力库（用户不再选 skill 包） */
export const DEFAULT_ORCHESTRATOR_ID = "world-simulator";

/**
 * 首屏引导兜底（包内 orchestrator.md `uiPrompt` 优先）。
 * 词汇与 design-intake A1/A2 对齐：站位 + 系统扮演/输出/交互。
 */
export const DEFAULT_UI_PROMPT = `请用你自己的话描述想做什么——没有必填项，下面只是帮你找思路的提示。

【你扮演什么】（可对照，也可不按表）
· 单角代入：我就是一个固定角色
· 代理操控：我有角色，但常发 () 指令指挥
· 旁观/实验：我不扮演谁，看或记录推演
· 写手/统筹：我定方向，要成稿或助手式分段（长文 / 爽文也走这条）
· 多角切换：我轮流扮演不同身份

【系统要给你什么】（输出与交互，不是文风问卷）
· 回合对话：你一句，系统回一段可见结果
· 助手分段：先大纲/细纲，你再填表或改设定，再按章/段写正文
· 只要事实摘要 / 要可读叙事 / 要状态表…

【输入约定】可选用括号区分：
· () 圆括号：用户指令/要求，不可写成角色对白
· "" 双引号：角色在世界内说的话
· 【】方括号：角色在世界内的行动
未加标记时默认可视为世界内输入；语义明显是元话语按指令处理。

【核心体验】若愿意可带一句：你最想反复感到的是什么——没有也没关系，我会从描述里察觉。

示例：丧尸世界但我不会被感染；1v1 网恋；都市爽文先写大纲再按章开写；坠机求生；思想实验旁观三方选择……`;

export function resolveDefaultOrchestratorId(
  available: SkillIndexEntry[],
): string {
  if (available.some((s) => s.name === DEFAULT_ORCHESTRATOR_ID)) {
    return DEFAULT_ORCHESTRATOR_ID;
  }
  if (available.length === 0) {
    throw new Error("registry 中没有可用 orchestrator");
  }
  return available[0].name;
}

/** 兼容旧快照：world-simulator 默认 agent-first（UI 引导 → 用户输入 → Agent 调 Skill） */
export function effectiveStartupMode(
  skill: Pick<ActiveSkillSnapshot, "name" | "startupMode">,
): SkillStartupMode {
  if (skill.startupMode === "agent-first" || skill.startupMode === "intake") {
    return skill.startupMode;
  }
  // 旧 frontmatter design-intake bootstrap 已废弃，等同 agent-first
  if (skill.startupMode === "design-intake") return "agent-first";
  if (skill.name === DEFAULT_ORCHESTRATOR_ID) return "agent-first";
  return "intake";
}
