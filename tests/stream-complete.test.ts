import { describe, expect, it } from "vitest";
import { consumeOpenAiToolStream } from "../src/llm/stream-complete.js";

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("consumeOpenAiToolStream", () => {
  it("reads reasoning from reasoning_content and content from delta", async () => {
    const parts = await consumeOpenAiToolStream(
      sseStream([
        'data: {"choices":[{"delta":{"reasoning_content":"想一下"}}]}\n',
        'data: {"choices":[{"delta":{"content":"门开了"}}]}\n',
        "data: [DONE]\n",
      ]),
      {},
    );
    expect(parts.reasoning).toBe("想一下");
    expect(parts.content).toBe("门开了");
  });

  it("accepts reasoning / thinking aliases and last-frame message content", async () => {
    const parts = await consumeOpenAiToolStream(
      sseStream([
        'data: {"choices":[{"delta":{"reasoning":"先想"}}]}\n',
        'data: {"choices":[{"message":{"content":"她摘下耳机。"}}]}\n',
        "data: [DONE]\n",
      ]),
      {},
    );
    expect(parts.reasoning).toBe("先想");
    expect(parts.content).toBe("她摘下耳机。");
  });
});
