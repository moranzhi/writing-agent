import type { ChatMessage, LlmProvider } from "../llm/client.js";
import { tryParseJsonDoc } from "../parse/json-doc.js";
import {
  intakeSystemPrompt,
  nextWaveSystemPrompt,
  outlineSystemPrompt,
  redirectSystemPrompt,
  sectionSystemPrompt,
} from "./prompt.js";
import type { ListenSerialState } from "./types.js";

export type IntakeLlmResult =
  | { type: "ask"; reply: string }
  | {
      type: "propose";
      reply: string;
      thrill: string;
      world: string;
      structure: string;
    };

export type OutlineLlmResult = {
  titles: string[];
  payoffTitle: string;
  reply: string;
  thrill?: string;
};

export type SectionLlmResult = {
  text: string;
  summary: string;
  fulfilled: boolean;
};

export type RedirectLlmResult = {
  titles: string[];
  payoffTitle: string;
  thrillOverride: string;
  reply: string;
};

async function completeJson(
  llm: LlmProvider,
  system: string,
  user: string,
  caller: string,
): Promise<Record<string, unknown>> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const result = await llm.complete(messages, {
    responseFormat: "json_object",
    caller,
    label: "听书连载",
  });
  const parsed = tryParseJsonDoc(result.content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("听书连载：模型未返回合法 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter(Boolean);
}

export async function llmIntake(
  llm: LlmProvider,
  dialogue: Array<{ role: "user" | "assistant"; text: string }>,
): Promise<IntakeLlmResult> {
  const transcript = dialogue
    .map((t) => `${t.role === "user" ? "用户" : "助手"}：${t.text}`)
    .join("\n\n");
  const obj = await completeJson(
    llm,
    intakeSystemPrompt(),
    transcript || "（用户尚未说话）",
    "listen_serial_intake",
  );
  const type = str(obj.type) === "propose" ? "propose" : "ask";
  const reply = str(obj.reply) || (type === "ask" ? "还需要一点材料。" : "请确认本局草案。");
  if (type === "ask") return { type, reply };
  return {
    type: "propose",
    reply,
    thrill: str(obj.thrill),
    world: str(obj.world),
    structure: str(obj.structure),
  };
}

export async function llmOutline(
  llm: LlmProvider,
  state: ListenSerialState,
  userNote?: string,
): Promise<OutlineLlmResult> {
  const obj = await completeJson(
    llm,
    outlineSystemPrompt(state),
    userNote?.trim() || "请生成本段大纲。",
    "listen_serial_outline",
  );
  const titles = strList(obj.titles);
  const payoffTitle = str(obj.payoff_title) || titles[titles.length - 1] || "";
  return {
    titles,
    payoffTitle,
    reply: str(obj.reply) || "大纲已就绪，开始写正文。",
  };
}

export async function llmNextWave(
  llm: LlmProvider,
  state: ListenSerialState,
): Promise<OutlineLlmResult> {
  const obj = await completeJson(
    llm,
    nextWaveSystemPrompt(state),
    "请开下一波爽点大纲。",
    "listen_serial_next_wave",
  );
  const titles = strList(obj.titles);
  return {
    titles,
    payoffTitle: str(obj.payoff_title) || titles[titles.length - 1] || "",
    reply: str(obj.reply) || "下一波大纲已就绪。",
    thrill: str(obj.thrill) || undefined,
  };
}

export async function llmSection(
  llm: LlmProvider,
  state: ListenSerialState,
  nextTitle: string,
): Promise<SectionLlmResult> {
  const obj = await completeJson(
    llm,
    sectionSystemPrompt(state, nextTitle),
    `请写标题「${nextTitle}」的正文。`,
    "listen_serial_section",
  );
  return {
    text: str(obj.text),
    summary: str(obj.summary),
    fulfilled: Boolean(obj.fulfilled),
  };
}

export async function llmRedirect(
  llm: LlmProvider,
  state: ListenSerialState,
  opinion: string,
): Promise<RedirectLlmResult> {
  const obj = await completeJson(
    llm,
    redirectSystemPrompt(state, opinion),
    opinion,
    "listen_serial_redirect",
  );
  const titles = strList(obj.titles);
  return {
    titles,
    payoffTitle: str(obj.payoff_title) || titles[titles.length - 1] || "",
    thrillOverride: str(obj.thrill_override),
    reply: str(obj.reply) || "已按你的意见改后面的走向。",
  };
}
