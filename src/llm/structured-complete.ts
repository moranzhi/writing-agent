/**
 * 按 profile 能力选路的 structured 完成：json_schema → forced_tool → json_object。
 */
import {
  resolveStructuredDeliveryMode,
  type ProfileCapabilities,
  type StructuredDeliveryMode,
} from "./capabilities.js";
import type {
  ChatMessage,
  CompleteOptions,
  CompleteResult,
  LlmProvider,
  ToolDefinition,
} from "./client.js";
import { tryParseJsonDoc } from "../parse/json-doc.js";

export type StructuredCompleteOptions = CompleteOptions & {
  /** JSON Schema 对象（json_schema / tool parameters 共用） */
  schema: Record<string, unknown>;
  /** schema / tool 名称 */
  name: string;
  /** 覆盖自动选路 */
  mode?: StructuredDeliveryMode;
  capabilities?: ProfileCapabilities | null;
  /**
   * schema 含 additionalProperties:true 等、无法走 strict json_schema 时置 true。
   * 会自动降级：forced_tool → json_object。
   */
  schemaIsLoose?: boolean;
  /** forced_tool 时是否尝试 strict（默认：capabilities.strictTool===ok 且非 loose） */
  preferStrictTool?: boolean;
  stream?: import("./client.js").StreamCallbacks;
};

export type StructuredCompleteResult = CompleteResult & {
  parsed: unknown;
  mode: StructuredDeliveryMode;
};

function parseObjectPayload(raw: string): unknown {
  const parsed = tryParseJsonDoc(raw);
  if (parsed != null) return parsed;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("structured 输出无法解析为 JSON");
  }
}

function buildSubmitTool(
  name: string,
  schema: Record<string, unknown>,
  strict: boolean,
): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description: `Submit the structured result as arguments to ${name}. Always call this tool.`,
      parameters: schema,
      ...(strict ? { strict: true } : {}),
    },
  };
}

/**
 * 一次 structured 完成：返回解析后的对象。
 * forced_tool 路径走 completeWithTools；其余走 complete / completeStream。
 */
export async function completeStructured(
  llm: LlmProvider,
  messages: ChatMessage[],
  options: StructuredCompleteOptions,
): Promise<StructuredCompleteResult> {
  const requested =
    options.mode ?? resolveStructuredDeliveryMode(options.capabilities);
  let mode = requested;
  if (options.schemaIsLoose && mode === "json_schema") {
    mode =
      options.capabilities?.forcedTool === "ok"
        ? "forced_tool"
        : options.capabilities?.jsonObject === "ok"
          ? "json_object"
          : "text";
  }
  const schemaName = options.name || "submit_result";

  if (mode === "forced_tool") {
    const strict =
      !options.schemaIsLoose &&
      (options.preferStrictTool ??
        options.capabilities?.strictTool === "ok");
    const tools = [buildSubmitTool(schemaName, options.schema, strict)];
    const result = await llm.completeWithTools(messages, {
      ...options,
      tools,
      toolChoice: "required",
      responseFormat: undefined,
      jsonSchema: undefined,
    });
    const call =
      result.toolCalls.find((t) => t.name === schemaName) ??
      result.toolCalls[0];
    if (!call) {
      throw new Error("forced_tool 模式未返回 tool_calls");
    }
    const parsed = parseObjectPayload(call.arguments);
    return {
      content: call.arguments,
      reasoning: result.reasoning,
      usage: result.usage,
      model: result.model,
      parsed,
      mode,
    };
  }

  const completeOpts: CompleteOptions = {
    ...options,
    responseFormat:
      mode === "json_schema"
        ? "json_schema"
        : mode === "json_object"
          ? "json_object"
          : "text",
    jsonSchema:
      mode === "json_schema"
        ? { name: schemaName, strict: true, schema: options.schema }
        : undefined,
  };

  let result: CompleteResult;
  if (options.stream && llm.completeStream) {
    result = await llm.completeStream(messages, completeOpts, options.stream);
  } else {
    result = await llm.complete(messages, completeOpts);
  }

  const parsed = parseObjectPayload(result.content);
  return { ...result, parsed, mode };
}
