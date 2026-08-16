import { describe, expect, it } from "vitest";
import {
  appendAskedQuestions,
  dropAlreadyAskedQuestions,
  formatQuestionAnswersForAi,
  formatQuestionAnswersForDisplay,
  isModuleOpeningQuestions,
  MODULE_OPENING_QUESTION_ID,
  mergeQuestionsPreferFragment,
  normalizeQuestions,
  parseAskedQuestions,
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

describe("isModuleOpeningQuestions", () => {
  it("recognizes the single module-opening question", () => {
    const qs = normalizeQuestions([
      {
        id: MODULE_OPENING_QUESTION_ID,
        prompt: "本轮生成对象已钉死。请直接谈…",
        allowOther: true,
        required: true,
      },
    ]);
    expect(isModuleOpeningQuestions(qs)).toBe(true);
  });

  it("rejects ordinary worker questions", () => {
    const qs = normalizeQuestions([
      { id: "q1", prompt: "要不要池？" },
    ]);
    expect(isModuleOpeningQuestions(qs)).toBe(false);
    expect(isModuleOpeningQuestions([])).toBe(false);
    expect(isModuleOpeningQuestions(null)).toBe(false);
  });
});
describe("mergeQuestionsPreferFragment", () => {
  it("keeps the 示例 version when askUser repeats the same options", () => {
    const ask = normalizeQuestions([
      {
        prompt: "为贴近你要的质感：你最想反复感受到的是哪一种？",
        options: [
          "隐于都市的日常从容：所有人都只是凡人，而你心里清楚世界是你的",
          "身份揭示的瞬间翻转：前一刻还被人平视甚至冒犯，后一刻万人噤声",
        ],
      },
      {
        prompt: "在你亮明身份之前，你希望普通世界如何对待你？",
        options: [
          "基本礼貌但无特别敬畏，偶尔会有微小冒犯",
          "因你气质不凡而隐隐客气，但没人知道原因",
        ],
      },
    ]);
    const frag = normalizeQuestions([
      {
        prompt:
          "你最想反复感受到的是哪一种？\n示例：比如：走在现代街头，有人撞了你一下。",
        options: [
          "隐于都市的日常从容：所有人都只是凡人，而你心里清楚世界是你的",
          "身份揭示的瞬间翻转：前一刻还被人平视甚至冒犯，后一刻万人噤声",
        ],
      },
      {
        prompt:
          "在你亮明身份之前，你希望普通世界如何对待你？\n示例：这样我才好确定叙事里普通人对你的默认距离。",
        options: [
          "基本礼貌但无特别敬畏，偶尔会有微小冒犯",
          "因你气质不凡而隐隐客气，但没人知道原因",
        ],
      },
    ]);
    const merged = mergeQuestionsPreferFragment(ask, frag);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.prompt).toContain("示例：");
    expect(merged[1]?.prompt).toContain("示例：");
  });

  it("keeps askUser-only questions that are not in the fragment", () => {
    const ask = normalizeQuestions([
      { prompt: "人称？", options: ["第二人称", "第一人称"] },
    ]);
    const frag = normalizeQuestions([
      {
        prompt: "暴力尺度？\n示例：锈迹即可",
        options: ["少而锋利", "常态压抑"],
      },
    ]);
    const merged = mergeQuestionsPreferFragment(ask, frag);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.prompt).toContain("暴力尺度");
    expect(merged[1]?.prompt).toBe("人称？");
  });
});

describe("已问追问去重", () => {
  const aesthetics = normalizeQuestions([
    {
      id: "focus",
      prompt: "「永远有 1 万元余额」这个设定，你希望体验更偏向哪种？",
      options: [
        "用这 1 万元在城市里精打细算地活下去",
        "靠这 1 万元撬动关系、机会与影响力",
      ],
    },
  ]);

  it("编排层重抛上一步问过的题时整题丢掉", () => {
    const history = appendAskedQuestions([], aesthetics);
    const replanned = normalizeQuestions([
      {
        id: "focus",
        prompt: "「永远有 1 万元余额」这个设定，你希望体验更偏向哪种？",
        options: [
          "用这 1 万元在城市里精打细算地活下去",
          "靠这 1 万元撬动关系、机会与影响力",
        ],
      },
    ]);
    expect(dropAlreadyAskedQuestions(replanned, history)).toHaveLength(0);
  });

  it("新问题照常保留", () => {
    const history = appendAskedQuestions([], aesthetics);
    const fresh = normalizeQuestions([
      { prompt: "下一步先排实现机制还是叙事指南？", options: ["实现机制"] },
    ]);
    expect(dropAlreadyAskedQuestions(fresh, history)).toHaveLength(1);
  });

  it("留痕可经 slots 往返，且同题不重复堆积", () => {
    const once = appendAskedQuestions([], aesthetics);
    const twice = appendAskedQuestions(once, aesthetics);
    expect(twice).toHaveLength(1);
    const roundTripped = parseAskedQuestions(JSON.stringify(twice));
    expect(dropAlreadyAskedQuestions(aesthetics, roundTripped)).toHaveLength(0);
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
