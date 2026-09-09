import type { ToolDefinition } from "../llm/client.js";

/**
 * Boss 直聘创作期工具：产物 / 变量 / 映射均须 toolcall；聊天只做确认与建议。
 */
export const DICTATE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "insert",
      description:
        "写入不变型固定产物（设定/格式/开场等）。确认与建议只写在普通回复。用 order 标相对先后。",
      parameters: {
        type: "object",
        properties: {
          position: {
            type: "string",
            description:
              "产物 tag，须以「用户.」或「设计.」开头。例：用户.需求、设计.正文组成、设计.开场白。勿用本工具写变量目录/映射。",
          },
          content: {
            type: "string",
            description:
              "落入该位置的正文。设计.正文组成=格式 JSON；设计.开场白=可读开场（Markdown）",
          },
          order: {
            type: "number",
            description:
              "相对顺序（可负）。越小越靠前。越常改越大。省略则沿用原序或默认。",
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
      name: "declare_variable",
      description:
        "声明或更新一个跨轮真值变量（写入设计.变量目录）。可见性、初值在此钉死；映射用 declare_map。",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "字段名，如 好、章节、地点",
          },
          type: {
            type: "string",
            description: "number | string | boolean | enum",
          },
          initial: {
            description: "初值（数字/字符串/布尔）",
          },
          user_visible: {
            type: "boolean",
            description: "是否对用户可见（监控栏等）；默认 true",
          },
          note: {
            type: "string",
            description: "备注（可选）",
          },
        },
        required: ["key"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "declare_map",
      description:
        "声明真值→投影上下文的映射（写入设计.变量映射）。投影 tag 槽位固定，内容随真值换档。",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "映射 id，如 affinity-attitude",
          },
          field: {
            type: "string",
            description: "依赖的真值字段名（须已 declare_variable）",
          },
          target_tag: {
            type: "string",
            description: "投影 tag，须以「上下文.」或「大纲.」开头，如 上下文.角色态度",
          },
          bands: {
            type: "array",
            description:
              "分档：区间用 min(含)/max(不含)+content；精确用 value+content；兜底用 when=default+content",
            items: {
              type: "object",
              properties: {
                when: { type: "string", description: "range | eq | default；可省略，有 min/max 即区间" },
                min: { type: "number" },
                max: { type: "number" },
                value: {},
                content: { type: "string" },
              },
              required: ["content"],
            },
          },
          note: { type: "string" },
        },
        required: ["id", "field", "target_tag", "bands"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_dialogue",
      description: "对话过长时清空对话。产物与变量/映射保留。",
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
