import { describe, expect, it } from "vitest";
import { ttsCacheKey } from "../src/tts/cache.js";
import { DEFAULT_TTS_PROVIDER, resolveTtsProvider } from "../src/tts/index.js";

describe("tts cache / provider", () => {
  it("hashes stable keys", () => {
    const a = ttsCacheKey({
      provider: "edge",
      voice: "zh-CN-XiaoxiaoNeural",
      text: "你好",
      extra: "s1",
    });
    const b = ttsCacheKey({
      provider: "edge",
      voice: "zh-CN-XiaoxiaoNeural",
      text: "你好",
      extra: "s1",
    });
    const c = ttsCacheKey({
      provider: "edge",
      voice: "zh-CN-XiaoxiaoNeural",
      text: "你好啊",
      extra: "s1",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.length).toBe(40);
  });

  it("defaults provider to edge", () => {
    expect(DEFAULT_TTS_PROVIDER).toBe("edge");
    const prev = process.env.WRITING_AGENT_TTS_PROVIDER;
    delete process.env.WRITING_AGENT_TTS_PROVIDER;
    expect(resolveTtsProvider()).toBe("edge");
    process.env.WRITING_AGENT_TTS_PROVIDER = prev;
  });
});
