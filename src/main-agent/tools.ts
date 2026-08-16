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
      name: "run_worker",
      description: "执行选中的下一个创作节点。",
      parameters: {
        type: "object",
        properties: {
          workerId: { type: "string" },
          reason: { type: "string" },
          requiresApproval: {
            type: "boolean",
            description: "true 时需用户确认后才执行",
          },
        },
        required: ["workerId", "reason", "requiresApproval"],
        additionalProperties: false,
      },
    },
  },
];
