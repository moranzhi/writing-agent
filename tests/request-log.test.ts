import { describe, expect, it } from "vitest";
import type { ChatMessage, ToolDefinition } from "../src/llm/client.js";
import {
  describeRequestAwaiting,
  formatLlmAbortLine,
  formatLlmFailLine,
  formatLlmFinishLine,
  formatLlmSendLine,
} from "../src/llm/request-log.js";

const insertTool: ToolDefinition = {
  type: "function",
  function: {
    name: "insert",
    description: "write",
    parameters: {},
  },
};

describe("describeRequestAwaiting", () => {
  it("flags first user turn", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "你是对话落盘创作助手" },
      { role: "user", content: "傀儡皇帝恋爱体验……很长一段用户原话" },
    ];
    expect(describeRequestAwaiting(messages)).toBe("待答用户");
  });

  it("flags digesting insert without repeating content", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "用户原话" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: {
              name: "insert",
              arguments: "{\"position\":\"设计.美学纲领与交互范式\",\"content\":\"很长正文\"}",
            },
          },
        ],
      },
      { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" },
    ];
    expect(describeRequestAwaiting(messages)).toBe("待消化 写入产物");
    const line = formatLlmSendLine({
      kind: "tools-stream",
      caller: "dictate_agent",
      label: "对话落盘 第2轮",
      messages,
      tools: [insertTool],
    });
    expect(line).toContain("发送 对话落盘 第2轮 · 工具流式");
    expect(line).toContain("待消化 写入产物");
    expect(line).toContain("条=系统1+用户1+助手1+工具1");
    expect(line).toContain("可调 写入产物");
    expect(line).not.toContain("很长正文");
    expect(line).not.toContain("用户原话");
  });
});

describe("formatLlmSendLine", () => {
  it("summarizes a dictate first round", () => {
    const line = formatLlmSendLine({
      kind: "tools-stream",
      caller: "dictate_agent",
      label: "对话落盘 第1轮",
      messages: [
        { role: "system", content: "x".repeat(12000) },
        { role: "user", content: "写长文" },
      ],
      tools: [insertTool],
    });
    expect(line).toBe(
      "发送 对话落盘 第1轮 · 工具流式  待答用户  条=系统1+用户1  可调 写入产物  上下文≈1.2万字",
    );
  });
});

describe("formatLlmFinishLine", () => {
  it("reports completion without dumping body", () => {
    const line = formatLlmFinishLine(
      {
        kind: "tools-stream",
        caller: "dictate_agent",
        label: "对话落盘 第1轮",
        messages: [],
      },
      7306,
      {
        content: "短确认",
        reasoning: "",
        model: "deepseek-v4-pro",
        toolCalls: [{ id: "1", name: "insert", arguments: "SECRET_BODY" }],
        usage: { promptTokens: 14385, completionTokens: 413, totalTokens: 14798 },
      },
    );
    expect(line).toContain("完成 对话落盘 第1轮 · 工具流式");
    expect(line).toContain("7306毫秒");
    expect(line).toContain("模型=deepseek-v4-pro");
    expect(line).toContain("调用=写入产物");
    expect(line).toContain("用量=14385+413");
    expect(line).not.toContain("SECRET_BODY");
    expect(line).not.toContain("短确认");
  });
});

describe("abort and fail lines", () => {
  it("marks user abort separately from failure", () => {
    expect(
      formatLlmAbortLine(
        { kind: "tools-stream", caller: "dictate_agent", label: "对话落盘 第1轮" },
        2100,
      ),
    ).toBe("中断 对话落盘 第1轮 · 工具流式  2100毫秒");
    expect(
      formatLlmFailLine(
        { kind: "stream", caller: "worker:design-step", label: "设计监控栏" },
        10787,
        new Error("fetch failed"),
      ),
    ).toBe("失败 执行单元 design-step · 设计监控栏 · 流式  10787毫秒  fetch failed");
  });
});
