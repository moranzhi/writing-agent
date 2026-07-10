import { randomUUID } from "node:crypto";
import type { ParsedToolCall } from "../llm/client.js";
import type { MainAgentDecision } from "../types/runtime.js";
import {
  isMainAgentLoopTool,
  isMainAgentTerminalTool,
  type MainAgentToolName,
} from "../types/tools.js";

export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolValidationError";
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ToolValidationError("Tool arguments must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof ToolValidationError) throw e;
    throw new ToolValidationError(`Invalid tool arguments JSON: ${raw.slice(0, 120)}`);
  }
}

function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const val = args[key];
  if (typeof val !== "string" || !val.trim()) {
    throw new ToolValidationError(`Tool parameter "${key}" must be a non-empty string`);
  }
  return val.trim();
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = args[key];
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  return trimmed || undefined;
}

/** 将终止 tool call 转为 MainAgentDecision */
export function toolCallToDecision(call: ParsedToolCall): MainAgentDecision {
  const name = call.name;
  if (!isMainAgentTerminalTool(name)) {
    throw new ToolValidationError(`Not a terminal tool: ${name}`);
  }

  const args = parseArgs(call.arguments);

  switch (name as MainAgentToolName) {
    case "ask_user": {
      const reason = requireString(args, "reason");
      const message = optionalString(args, "message");
      return {
        id: randomUUID(),
        action: "ask_user",
        reason: message ? `${reason}\n${message}` : reason,
        requiresApproval: false,
        statePatchAllowed: false,
      };
    }
    case "run_worker": {
      const workerId = requireString(args, "workerId");
      const reason = requireString(args, "reason");
      const requiresApproval = Boolean(args.requiresApproval);
      const roleId = optionalString(args, "roleId");
      return {
        id: randomUUID(),
        action: "run_worker",
        reason,
        workerId,
        workerContext: roleId ? { roleId } : undefined,
        requiresApproval,
        statePatchAllowed: false,
      };
    }
    case "review_blackboard": {
      const reason = requireString(args, "reason");
      const summary = requireString(args, "summary");
      return {
        id: randomUUID(),
        action: "review_blackboard",
        reason: `${reason}\n${summary}`,
        requiresApproval: false,
        statePatchAllowed: false,
      };
    }
    case "finish": {
      const reason = requireString(args, "reason");
      return {
        id: randomUUID(),
        action: "finish",
        reason,
        requiresApproval: false,
        statePatchAllowed: false,
      };
    }
    default:
      throw new ToolValidationError(`Unknown terminal tool: ${name}`);
  }
}

export function validateLoopToolCall(call: ParsedToolCall): MainAgentToolName {
  if (!isMainAgentLoopTool(call.name)) {
    throw new ToolValidationError(`Unknown loop tool: ${call.name}`);
  }
  parseArgs(call.arguments);
  return call.name;
}
