import type { ToolDefinition } from "../llm/client.js";

/**
 * 转述创作期工具：只允许用 toolcall 写产物。
 * insert(position, content, order?) —— 打标记落盘并带相对序。
 */
export const DICTATE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "insert",
      description:
        "唯一写产物入口：把正文插入黑板。确认/建议/思考只写在普通回复，禁止放进 content。用 order 标相对先后以便拼装。",
      parameters: {
        type: "object",
        properties: {
          position: {
            type: "string",
            description:
              "插入位置（产物 tag）。须以「用户.」或「设计.」开头。例：用户.需求、设计.正文组成、设计.开场白",
          },
          content: {
            type: "string",
            description:
              "落入该位置的正文。设计.正文组成=格式 JSON；设计.开场白=可读开场（Markdown，用 ## 分段，勿写【body】、勿夹确认/建议）",
          },
          order: {
            type: "number",
            description:
              "相对顺序（可负、0、正）。越小越靠前。原则：越常改越大（靠后）；改动频率差不多时，越重要越小（靠前）。省略则沿用原序或按 tag 默认。",
          },
        },
        required: ["position", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_dialogue",
      description:
        "对话过长时清空对话记录。产物保留。清空后继续用自然语言回复用户。",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "为何清空（一句话）",
          },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
];
