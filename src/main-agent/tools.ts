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
      description: "信息不足时向用户提问，将暂停 agent 循环等待用户输入。",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "为何需要用户输入" },
          message: { type: "string", description: "展示给用户的问题或说明" },
        },
        required: ["reason"],
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
