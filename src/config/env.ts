import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function loadLlmConfig(): LlmConfig {
  const baseUrl =
    process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com";
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  const model = process.env.OPENAI_MODEL ?? "deepseek-v4-pro";

  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Set it in environment or use --mock for offline demo.",
    );
  }

  return { baseUrl, apiKey, model };
}

export function loadLlmConfigOptional(): LlmConfig | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com",
    apiKey,
    model: process.env.OPENAI_MODEL ?? "deepseek-v4-pro",
  };
}

export function loadDotEnv(cwd = process.cwd()): void {
  const envPath = path.join(cwd, ".env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
