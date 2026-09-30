/**
 * 拉取 OpenAI 兼容的 GET {base}/models，供同一 API 配置下快捷切换模型。
 */

const MAX_BODY_CHARS = 2_000_000;
const MAX_MODELS = 4000;

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** 按常见兼容网关尝试 models 地址。base 已含 /v1 时只打一次。 */
export function modelListUrls(baseUrl: string): string[] {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) return [];
  const urls: string[] = [];
  const push = (url: string) => {
    if (!urls.includes(url)) urls.push(url);
  };
  push(`${base}/models`);
  const lower = base.toLowerCase();
  if (!/\/v1(?:beta)?(?:\/|$)/.test(lower)) {
    push(`${base}/v1/models`);
    push(`${base}/api/v1/models`);
  }
  return urls;
}

function modelIdOf(item: unknown): string | null {
  if (typeof item === "string") {
    const id = item.trim();
    return id && id.length <= 200 ? id : null;
  }
  if (!item || typeof item !== "object") return null;
  const rec = item as { id?: unknown; name?: unknown };
  const raw = typeof rec.id === "string" ? rec.id : rec.name;
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return id && id.length <= 200 ? id : null;
}

/** 识别 { data: [{id}] }、{ models } 或纯数组。无法识别返回 null。 */
export function parseModelsPayload(data: unknown): string[] | null {
  let list: unknown[] | null = null;
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === "object") {
    const rec = data as { data?: unknown; models?: unknown; error?: unknown };
    if (rec.error && !Array.isArray(rec.data) && !Array.isArray(rec.models)) {
      return null;
    }
    if (Array.isArray(rec.data)) list = rec.data;
    else if (Array.isArray(rec.models)) list = rec.models;
  }
  if (!list) return null;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of list) {
    const id = modelIdOf(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_MODELS) break;
  }
  return ids;
}

type FetchOutcome =
  | { ok: true; models: string[] }
  | { ok: false; stop: boolean; message: string };

async function fetchModelList(url: string, apiKey: string): Promise<FetchOutcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "请求失败";
    return { ok: false, stop: false, message: `${url} ${message}` };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      stop: true,
      message: `API Key 被拒绝（${response.status}）`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      stop: false,
      message: `${url} → ${response.status}`,
    };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取失败";
    return { ok: false, stop: false, message: `${url} ${message}` };
  }
  if (text.length > MAX_BODY_CHARS) {
    return { ok: false, stop: false, message: `${url} 响应过大` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, stop: false, message: `${url} 不是 JSON` };
  }
  const models = parseModelsPayload(parsed);
  if (!models) {
    return { ok: false, stop: false, message: `${url} 没有模型列表` };
  }
  return { ok: true, models };
}

export async function discoverRemoteModels(
  baseUrl: string,
  apiKey: string,
): Promise<{ models: string[]; url: string }> {
  const key = apiKey.trim();
  if (!key) throw new Error("未设置 API Key");
  const urls = modelListUrls(baseUrl);
  if (!urls.length) throw new Error("缺少 Base URL");

  const errors: string[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i]!;
    const result = await fetchModelList(url, key);
    if (!result.ok) {
      if (result.stop) throw new Error(result.message);
      errors.push(result.message);
      continue;
    }
    const last = i === urls.length - 1;
    if (result.models.length === 0 && !last) {
      errors.push(`${url} 返回空列表`);
      continue;
    }
    return { models: result.models, url };
  }
  throw new Error(
    errors.length ? `未能嗅探模型。${errors.join("；")}` : "未能嗅探模型",
  );
}
