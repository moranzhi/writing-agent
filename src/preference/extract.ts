/**

 * 偏好提取：对话 → 可入库的短约束条目候选。

 */



import type { LlmProvider } from "../llm/client.js";

import { completeStructured } from "../llm/structured-complete.js";



export type PreferenceExtractMessage = {

  role: "user" | "assistant";

  content: string;

};



export type PreferenceExtractCandidate = {

  content: string;

  ready: boolean;

};



export type PreferenceExtractResult = {

  reply: string;

  candidates: PreferenceExtractCandidate[];

};



const EXTRACT_SCHEMA = {

  type: "object",

  additionalProperties: false,

  required: ["reply", "candidates"],

  properties: {

    reply: { type: "string" },

    candidates: {

      type: "array",

      items: {

        type: "object",

        additionalProperties: false,

        required: ["content", "ready"],

        properties: {

          content: { type: "string" },

          ready: { type: "boolean" },

        },

      },

    },

  },

} as const;



function buildSystemPrompt(params: {

  draftCandidates: string;

}): string {

  const draft = params.draftCandidates.trim() || "（尚无候选）";

  return `你正在帮用户从对话中提取**跨卡可复用偏好条目**（硬约束）。



任务：只写短、可执行的禁区/纠偏/默认取向；不写文风遣词、不写世界观与剧情。产物供「用户需求」节点选用。



每条 content：

- 一句到三句；写「不要 X，改做 Y」优于空泛「注意分寸」

- 一条只钉一件事；多件事拆成多条



规则：

1. reply：用人话简短回应；缺料时问 1～2 个具体点。

2. candidates：当前最好的条目列表（可增量改）；未成形可空数组。

3. ready=true 仅当该条已够入库；否则 false，继续追问。

4. 不要清空用户已认可的好条目。



当前候选草稿：

${draft}`;

}



function parseResult(parsed: unknown): PreferenceExtractResult {

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {

    return {

      reply: "未能解析提取结果，请再试一次。",

      candidates: [],

    };

  }

  const row = parsed as Record<string, unknown>;

  const reply =

    typeof row.reply === "string" && row.reply.trim()

      ? row.reply.trim()

      : "已记录。";

  const candidates: PreferenceExtractCandidate[] = [];

  if (Array.isArray(row.candidates)) {

    for (const item of row.candidates) {

      if (!item || typeof item !== "object" || Array.isArray(item)) continue;

      const c = item as Record<string, unknown>;

      const content = typeof c.content === "string" ? c.content.trim() : "";

      if (!content) continue;

      candidates.push({

        content,

        ready: c.ready === true,

      });

    }

  }

  return { reply, candidates };

}



export async function extractPreferenceTurn(params: {

  llm: LlmProvider;

  messages: PreferenceExtractMessage[];

  draftCandidates?: PreferenceExtractCandidate[];

}): Promise<PreferenceExtractResult> {

  const history = params.messages

    .filter((m) => m.content.trim())

    .slice(-16)

    .map((m) => ({

      role: m.role,

      content: m.content.trim(),

    }));

  if (!history.length) {

    throw new Error("请先说点对偏好/禁区的要求");

  }



  const draftText = (params.draftCandidates ?? [])

    .filter((c) => c.content.trim())

    .map((c, i) => `${i + 1}. ${c.content.trim()}${c.ready ? " 〔可入库〕" : ""}`)

    .join("\n");



  const system = buildSystemPrompt({ draftCandidates: draftText });



  const result = await completeStructured(

    params.llm,

    [{ role: "system", content: system }, ...history],

    {

      schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>,

      name: "preference_extract",

      schemaIsLoose: true,

      caller: "preference_extract",

    },

  );

  return parseResult(result.parsed);

}


