import type { ToolDefinition } from "../llm/client.js";

/** 总管可用 tool 的 OpenAI function 定义 */
export const MAIN_AGENT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_blackboard",
      description:
        "读取黑板 tag 正文。tags 可为精确 tag 或带 * 前缀模式。调度前用此了解已有内容。",
      parameters: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
            description: "要读取的 tag 或模式列表",
          },
        },
        required: ["tags"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_workers",
      description: "列出当前 skill 可调度的 worker id 与说明。",
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
      name: "list_artifacts",
      description: "列出当前会话 worker 产物（id、workerId、status、summary）。",
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
      name: "ask_user",
      description:
        "向用户追问。assessment 是给用户看的主内容（完备度评价）；questions 挂在其下，用户可跳过并请你基于现有信息继续。将暂停等待用户。",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description:
              "调度层短理由（正推：用户需要澄清 X → 因此追问）。勿把长文评价写这里。",
          },
          assessment: {
            type: "string",
            description:
              "给用户看的内容完备度评价（Markdown）。以【核心体验】为首要；按需列维度（不必凑齐），每维：完备度%、已知、待探。待探用【】标出互斥/可组合方向。评价只服务「用户想要什么」。",
          },
          message: {
            type: "string",
            description:
              "兼容旧字段：等同 assessment。优先传 assessment。",
          },
          questions: {
            type: "array",
            description:
              "挂在 assessment 下的可选追问（用户可不答）。基于「待探」出题，一次 1～2 题。prompt=明确选择题干；options=建议示范（可改写后采用）。",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "稳定 id，如 q1 / stance",
                },
                prompt: {
                  type: "string",
                  description:
                    "题干：引导用户选定一种详细体验倾向（例：「你更倾向于哪种皇帝的享受？」）。",
                },
                options: {
                  type: "array",
                  description:
                    "2～4 个建议示范。label 写完整可采纳文案（可先一句场景钩子再点题），不是标签词。",
                  items: {
                    type: "object",
                    properties: {
                      id: {
                        type: "string",
                        description: "A/B/C…",
                      },
                      label: {
                        type: "string",
                        description:
                          "建议正文：用户点选后可直接当答案，也可改写。例：「冰冷的、主宰一切的权力感——九重宫阙一言定生死…」",
                      },
                      editable: {
                        type: "boolean",
                        description: "默认 true：点文案可改写，点字母才选中",
                      },
                    },
                    required: ["label"],
                  },
                },
                allowOther: {
                  type: "boolean",
                  description: "默认 true：允许 Other 自拟",
                },
                required: {
                  type: "boolean",
                  description: "默认 false（可选追问）；仅关键阻塞题才 true",
                },
              },
              required: ["prompt", "options"],
            },
          },
        },
        required: ["reason", "assessment", "questions"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_worker",
      description:
        "调度 worker 执行任务。只传 workerId，inputTags/outputTags 由 Runtime 从 Worker Skill 读取。",
      parameters: {
        type: "object",
        properties: {
          workerId: { type: "string" },
          reason: { type: "string" },
          requiresApproval: {
            type: "boolean",
            description: "true 时需用户确认后才执行",
          },
          roleId: {
            type: "string",
            description: "role-decide 等 worker 的当前角色 id",
          },
        },
        required: ["workerId", "reason", "requiresApproval"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "review_blackboard",
      description: "向用户说明当前黑板与进度概况，并暂停等待用户回复。",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          summary: { type: "string", description: "给用户看的概况说明" },
        },
        required: ["reason", "summary"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "正常结束当前创作流程。",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
];
