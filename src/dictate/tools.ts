import type { ToolDefinition } from "../llm/client.js";

/**
 * 对话落盘创作期工具：产物 / 变量 / 映射均须 toolcall；聊天只做确认与建议。
 */
export const DICTATE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "insert",
      description:
        "写入或覆盖固定产物。同 position 再调用即整份改写。可增殖（生成规则/具体实例）须用 基名#唯一id 拆分，禁止反复写基名覆盖。成功时可能返回 reply_module：末尾可见回复须附带该模块；同轮多个则每个模块各写一块 ## 模块 · 名称。确认与追问写在普通回复，不写进本工具。order 标相对先后。",
      parameters: {
        type: "object",
        properties: {
          position: {
            type: "string",
            description:
              "产物 tag，须以「用户.」或「设计.」开头。例：用户.需求、设计.正文组成、设计.开场白、设计.开场白#dorm；可增殖例：设计.生成规则#rule-id、设计.具体实例#batch-id、设计.主角设定#dorm。勿用本工具写变量目录/映射。",
          },
          content: {
            type: "string",
            description:
              "落入该位置的正文。设计.正文组成=格式 JSON；设计.开场白[#短码]=叙事正文（有正文组成时为 present.v1 JSON；否则 Markdown），必须含字面 @玩家，禁止写入用户角色.名字/简介；设计.主角设定[#同短码]=名字/背景/特殊设定 JSON，与开场同短码即绑定该开局",
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
      name: "delete",
      description:
        "删除一个已落盘的固定产物 tag（整份移除）。改内容请用 insert 覆盖；删变量字段用 undeclare_variable；删映射条目用 remove_map。勿用本工具写空 content 假装删除。",
      parameters: {
        type: "object",
        properties: {
          position: {
            type: "string",
            description:
              "要删的产物 tag，须以「用户.」或「设计.」开头。例：设计.开场白。删整份变量目录/映射也可（设计.变量目录 / 设计.变量映射）。",
          },
          reason: {
            type: "string",
            description: "为何删除（一句话，可选）",
          },
        },
        required: ["position"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undeclare_variable",
      description:
        "从设计.变量目录移除一个真值字段，并同步从变量.当前去掉该格。改初值/可见性请用 declare_variable。",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "要移除的字段名",
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
      name: "remove_map",
      description:
        "从设计.变量映射按 id 移除一条映射；若无其它映射共用其投影 tag，则一并删除该投影 tag。",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "映射 id（与 declare_map 时一致）",
          },
        },
        required: ["id"],
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
