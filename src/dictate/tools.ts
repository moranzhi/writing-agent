import type { ToolDefinition } from "../llm/client.js";

/**
 * 对话落盘创作期工具：产物 / 变量 / 映射均须 toolcall；聊天只做确认与建议。
 */
/** 第一次请求仅此一个工具：点出下一步要写的节点。 */
export const DICTATE_SELECT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "select_nodes",
    description:
      "规定下一步要写入的目标节点。nodes 只填能力目录中的 module_id。这一步不写产物正文。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        nodes: {
          type: "array",
          description: "这段用户话要填充的节点。",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              module_id: { type: "string", description: "能力目录中的 id" },
            },
            required: ["module_id"],
          },
        },
      },
      required: ["nodes"],
    },
  },
};

/** 写入循环的收尾。未通过的节点还在时，程序不把这份正文给用户。 */
export const DICTATE_REPLY_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "reply_user",
    description:
      "本步必调。与 insert 放在同一次请求：节点表写完后立刻提交给用户的综合回复。正文按系统提示「用户可见回复」写。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
          description:
            "综合回复。先回应原话并说明形成了什么，再写自评最稳处；每个分数一般的缺口含短例子、一句体验变化和 2～3 个可接着说的选项；接着写下一步可以提及哪些，并补一个相关设定。多个产物合成一段。",
        },
      },
      required: ["text"],
    },
  },
};

const WRITE_LOOP_TOOL_NAMES = new Set([
  "insert",
  "delete",
  "declare_variable",
  "undeclare_variable",
  "declare_map",
  "remove_map",
]);

export const DICTATE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_module",
      description:
        "读取一个内容能力当前版本的任务、原则、产物规格、评分规则、绑定库目录与程序约束。写该能力产物前必须先读取当前版本。",
      parameters: {
        type: "object",
        properties: {
          module_id: {
            type: "string",
            description: "能力 id 或中文名",
          },
          reason: {
            type: "string",
            description: "本轮为何读取（一句话，可选）",
          },
        },
        required: ["module_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_library_entry",
      description:
        "读取当前能力绑定库中本轮选中的条目。默认 1～2；叙事指南等多文风确需第三项时须提供 reason 并说明适用场合。",
      parameters: {
        type: "object",
        properties: {
          library_id: {
            type: "string",
            description: "当前能力绑定的库 id",
          },
          entry_ids: {
            type: "array",
            items: { type: "string" },
            description: "本轮选中的条目 id，默认最多两个",
          },
          reason: {
            type: "string",
            description: "读取超过两个条目时必填",
          },
        },
        required: ["library_id", "entry_ids"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prepare_opening",
      description:
        "用户该填的内容均已完成后、生成开场白之前单独调用。程序依次编译信息可见范围、游玩执行方式、上下文排序和运行配置；返回成功后再在下一步生成并 insert 开场白。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
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
              "产物 tag，须以「用户.」或「设计.」开头。例：用户.需求、设计.正文组成、设计.开场白#opening-cycle2；可增殖例：设计.生成规则#rule-id、设计.具体实例#batch-id、设计.主角设定#dorm。开场必须带场景短码，不要写裸「设计.开场白」或「设计.开场白与开场变量」。勿用本工具写变量目录/映射。",
          },
          content: {
            type: "string",
            description:
              "落入该位置的正文。设计.正文组成=格式 JSON；设计.开场白#场景短码=这一张开场的 present.v1，blocks 必须含正文组成数据契约里的全部模型生成区（用来灌进已固定前端并替换示例），不要只写 shell+body，也不要填程序投影区；必须含字面 @玩家，名字不进 blocks。这条开场的玩家角色写在 meta.用户角色（名字+一到三句客观事实），程序同步为同短码主角设定。这张开场有初值才在同一份正文里写开场变量，没有就不写。设计.主角设定=共通的名字/背景/特殊设定 JSON；各开场不同的玩家角色写进开场 meta，不另写主角设定#短码",
          },
          order: {
            type: "number",
            description:
              "同一变化频率组内的重要性顺序（可负）。基础材料用较小值，越接近生成时使用的合同越大；省略则沿用原序或默认。",
          },
          self_score: {
            type: "object",
            description:
              "能力已有 score 规则时必填；维度名须完全一致，1～5 分，分数不高于 3 时必须写 gap。",
            properties: {
              dims: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    score: { type: "number" },
                    gap: { type: "string" },
                    options: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["name", "score"],
                  additionalProperties: false,
                },
              },
            },
            required: ["dims"],
            additionalProperties: false,
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

/** 第二次起的工具。不含 read_module：写法已由程序注入。同一轮重试不改变这份清单。 */
export const DICTATE_WRITE_LOOP_TOOLS: ToolDefinition[] = [
  ...DICTATE_TOOL_DEFINITIONS.filter((tool) => WRITE_LOOP_TOOL_NAMES.has(tool.function.name)),
  DICTATE_REPLY_TOOL,
];
