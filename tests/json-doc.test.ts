import { describe, expect, it } from "vitest";
import {
  convertStructuralSmartQuotes,
  tryParseJsonDoc,
} from "../web/json-doc.js";

describe("tryParseJsonDoc", () => {
  it("joins a fragment whose root object closed before later keys", () => {
    const raw = `{
"schema":"context-fragment-v1",
"技能":"主角设定",
"brief":"点题",
"brief_ok":true,
"mount":"world-simulator"
},
"稳变":"stable",
"正文": { "称呼": "李宗" }
}`;
    const parsed = tryParseJsonDoc(raw);
    expect(parsed?.schema).toBe("context-fragment-v1");
    expect(parsed?.稳变).toBe("stable");
    expect(parsed?.正文?.称呼).toBe("李宗");
  });

  it("keeps interior Chinese quotes in an otherwise valid fragment", () => {
    const raw = JSON.stringify({
      schema: "context-fragment.v1",
      技能: "美学纲领与交互范式",
      正文: {
        设定逻辑: {
          参与方式: {
            用户与user关系: {
              依据: "用户明确“只有我不会被感染”，且为爽文主角",
            },
          },
        },
      },
    });
    const parsed = tryParseJsonDoc(`## 设计.美学纲领与交互范式\n\n${raw}`);
    expect(parsed?.技能).toBe("美学纲领与交互范式");
    expect(parsed?.正文?.设定逻辑?.参与方式?.用户与user关系?.依据).toContain(
      "只有我不会被感染",
    );
  });

  it("parses JSON that uses smart quotes as delimiters", () => {
    const raw = "{“schema”:“context-fragment.v1”,“brief”:“点题”}";
    expect(convertStructuralSmartQuotes(raw)).toBe(
      '{"schema":"context-fragment.v1","brief":"点题"}',
    );
    expect(tryParseJsonDoc(raw)).toEqual({
      schema: "context-fragment.v1",
      brief: "点题",
    });
  });
});
