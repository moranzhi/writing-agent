import { randomUUID } from "node:crypto";
import {
  getApiProfile,
  listApiProfiles,
  profileToLlmConfig,
} from "../config/api-profiles.js";
import {
  OpenAiCompatibleProvider,
  type ChatMessage as LlmChatMessage,
  type ToolCallPayload,
} from "../llm/client.js";
import type { LlmContextTrace } from "../types/context-trace.js";
import type { GenerationParameters } from "../types/preset.js";

export type CompareCandidateStatus = "pending" | "running" | "done" | "error";

export type CompareCandidate = {
  profileId: string;
  profileName: string;
  model: string;
  status: CompareCandidateStatus;
  content?: string;
  thinking?: string;
  error?: string;
  usage?: {
    totalTokens?: number;
    cachedTokens?: number;
    cacheMissTokens?: number;
  };
  finishedAt?: string;
};

export type ModelCompareJob = {
  id: string;
  sessionId: string;
  messageId: string;
  createdAt: string;
  status: "running" | "done" | "error";
  /** 原消息正文，便于预览对照 */
  original: {
    text: string;
    thinking?: string;
    model?: string;
  };
  candidates: CompareCandidate[];
};

const jobs = new Map<string, ModelCompareJob>();
const JOB_TTL_MS = 30 * 60 * 1000;

function pruneJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (Date.parse(job.createdAt) < cutoff) jobs.delete(id);
  }
}

/** 把 contextTrace 里冻住的条目还原成可发给 LLM 的 messages */
export function reconstructLlmMessages(
  trace: LlmContextTrace,
): LlmChatMessage[] {
  const out: LlmChatMessage[] = [];
  for (const item of trace.messages) {
    const role = String(item.role ?? "user");
    const raw = typeof item.content === "string" ? item.content : "";
    const restored = tryParseExtras(raw);
    if (restored) {
      out.push(restored);
      continue;
    }
    if (role === "assistant") {
      out.push({ role: "assistant", content: raw || null });
    } else if (role === "tool") {
      out.push({ role: "tool", content: raw, tool_call_id: "unknown" });
    } else if (role === "system") {
      out.push({ role: "system", content: raw });
    } else {
      out.push({ role: "user", content: raw });
    }
  }
  return out;
}

function tryParseExtras(raw: string): LlmChatMessage | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      role?: string;
      content?: string | null;
      tool_calls?: ToolCallPayload[];
      tool_call_id?: string;
    };
    if (!parsed || typeof parsed !== "object" || !parsed.role) return null;
    if (parsed.role === "assistant") {
      return {
        role: "assistant",
        content: parsed.content ?? null,
        ...(Array.isArray(parsed.tool_calls)
          ? { tool_calls: parsed.tool_calls }
          : {}),
      };
    }
    if (parsed.role === "tool" && parsed.tool_call_id) {
      return {
        role: "tool",
        content: typeof parsed.content === "string" ? parsed.content : "",
        tool_call_id: parsed.tool_call_id,
      };
    }
    if (parsed.role === "system" || parsed.role === "user") {
      return {
        role: parsed.role,
        content: typeof parsed.content === "string" ? parsed.content : "",
      };
    }
  } catch {
    /* plain text */
  }
  return null;
}

export function createCompareJob(input: {
  sessionId: string;
  messageId: string;
  profileIds: string[];
  original: ModelCompareJob["original"];
}): ModelCompareJob {
  pruneJobs();
  const uniqueIds = [...new Set(input.profileIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    throw new Error("请至少选择一个 API 配置");
  }
  const candidates: CompareCandidate[] = uniqueIds.map((profileId) => {
    const profile = getApiProfile(profileId);
    if (!profile?.apiKey?.trim()) {
      throw new Error(`API 配置不可用：${profileId}`);
    }
    return {
      profileId: profile.id,
      profileName: profile.name,
      model: profile.model,
      status: "pending" as const,
    };
  });
  const job: ModelCompareJob = {
    id: randomUUID(),
    sessionId: input.sessionId,
    messageId: input.messageId,
    createdAt: new Date().toISOString(),
    status: "running",
    original: input.original,
    candidates,
  };
  jobs.set(job.id, job);
  return job;
}

export function getCompareJob(jobId: string): ModelCompareJob | null {
  pruneJobs();
  return jobs.get(jobId) ?? null;
}

export function listProfilesForCompare(): Array<{
  id: string;
  name: string;
  model: string;
  hasKey: boolean;
}> {
  return listApiProfiles().map((p) => ({
    id: p.id,
    name: p.name,
    model: p.model,
    hasKey: Boolean(p.apiKey?.trim()),
  }));
}

/** 并行用各 profile 重放同一 contextTrace（不改会话） */
export async function runCompareJob(
  job: ModelCompareJob,
  trace: LlmContextTrace,
): Promise<ModelCompareJob> {
  const messages = reconstructLlmMessages(trace);
  if (messages.length === 0) {
    job.status = "error";
    for (const c of job.candidates) {
      c.status = "error";
      c.error = "上下文为空";
      c.finishedAt = new Date().toISOString();
    }
    return job;
  }

  const generation = trace.generation as GenerationParameters | undefined;
  await Promise.all(
    job.candidates.map(async (candidate) => {
      candidate.status = "running";
      try {
        const profile = getApiProfile(candidate.profileId);
        if (!profile?.apiKey?.trim()) {
          throw new Error("配置不存在或缺少 API Key");
        }
        const llm = new OpenAiCompatibleProvider(profileToLlmConfig(profile));
        const result = await llm.complete(messages, {
          generation,
          caller: `model-compare:${candidate.profileId}`,
        });
        candidate.content = result.content ?? "";
        candidate.thinking = result.reasoning;
        candidate.usage = result.usage
          ? {
              totalTokens: result.usage.totalTokens,
              cachedTokens: result.usage.cachedTokens,
              cacheMissTokens: result.usage.cacheMissTokens,
            }
          : undefined;
        if (result.model) candidate.model = result.model;
        candidate.status = "done";
      } catch (err) {
        candidate.status = "error";
        candidate.error = err instanceof Error ? err.message : String(err);
      } finally {
        candidate.finishedAt = new Date().toISOString();
      }
    }),
  );

  const anyDone = job.candidates.some((c) => c.status === "done");
  job.status = anyDone ? "done" : "error";
  return job;
}

export function findCandidate(
  job: ModelCompareJob,
  profileId: string,
): CompareCandidate | undefined {
  return job.candidates.find((c) => c.profileId === profileId);
}
