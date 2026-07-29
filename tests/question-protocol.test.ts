import { describe, expect, it } from "vitest";
import {
  formatQuestionAnswersForAi,
  formatQuestionAnswersForDisplay,
  normalizeQuestions,
} from "../src/skills/question-protocol.js";

describe("normalizeQuestions", () => {
  it("accepts string[]", () => {
    const qs = normalizeQuestions(["站位倾向？", "  "]);
    expect(qs).toHaveLength(1);
    expect(qs[0]?.prompt).toBe("站位倾向？");
    expect(qs[0]?.allowOther).toBe(true);
  });

  it("accepts structured items with options", () => {
    const qs = normalizeQuestions([
      {
        id: "stance",
        prompt: "你更想以什么身份玩？",
        options: ["单角幸存者代入", { id: "B", label: "旁观调度" }],
      },
    ]);
    expect(qs[0]?.id).toBe("stance");
    expect(qs[0]?.options).toHaveLength(2);
    expect(qs[0]?.options?.[0]?.id).toBe("A");
    expect(qs[0]?.options?.[0]?.label).toContain("幸存者");
  });
});

describe("formatQuestionAnswers", () => {
  it("AI payload keeps Q+A; display omits prompts", () => {
    const questions = normalizeQuestions([
      { id: "q1", prompt: "有无其它幸存者？", options: ["没有，仅自然生物"] },
    ]);
    const answers = [
      { questionId: "q1", optionId: "A", text: "没有，仅自然生物" },
    ];
    const ai = formatQuestionAnswersForAi(questions, answers);
    expect(ai).toContain("问：有无其它幸存者？");
    expect(ai).toContain("答：没有，仅自然生物");
    const display = formatQuestionAnswersForDisplay(questions, answers);
    expect(display).toBe("没有，仅自然生物");
    expect(display).not.toContain("问：");
  });

  it("appends free-text note to AI and display payloads", () => {
    const questions = normalizeQuestions([
      { id: "q1", prompt: "节奏？", options: ["严格回合制"] },
    ]);
    const answers = [
      { questionId: "q1", optionId: "A", text: "严格回合制" },
    ];
    const ai = formatQuestionAnswersForAi(questions, answers, "希望偏慢热");
    expect(ai).toContain("【补充】");
    expect(ai).toContain("希望偏慢热");
    const display = formatQuestionAnswersForDisplay(
      questions,
      answers,
      "希望偏慢热",
    );
    expect(display).toContain("严格回合制");
    expect(display).toContain("希望偏慢热");
  });
});
