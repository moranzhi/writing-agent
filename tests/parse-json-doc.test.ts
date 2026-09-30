import { describe, expect, it } from "vitest";
import {
  canonicalizeInsertedContent,
  extractLastProductJson,
  selectJsonPayload,
  tryParseJsonDoc,
} from "../src/parse/json-doc.js";

describe("canonicalizeInsertedContent", () => {
  it("extracts a broken fragment string into canonical JSON", () => {
    const raw = `{
"schema":"context-fragment-v1",
"技能":"主角设定",
"brief":"点题",
"mount":"world-simulator"
},
"正文": { "称呼": "@玩家" }
}`;
    const stored = canonicalizeInsertedContent(raw);
    expect(JSON.parse(stored)).toMatchObject({
      schema: "context-fragment.v1",
      技能: "主角设定",
      正文: { 称呼: "@玩家" },
    });
    expect(canonicalizeInsertedContent("开场是一段散文。")).toBe("开场是一段散文。");
  });
});

describe("selectJsonPayload", () => {
  it("keeps content when it is already the product", () => {
    const json = '{"schema":"context-fragment.v1","brief":"a","正文":{}}';
    expect(selectJsonPayload(json, "thinking...")).toBe(json);
  });

  it("falls back to reasoning when content is not JSON", () => {
    const json = '{"schema":"context-fragment.v1","brief":"a","正文":{}}';
    expect(selectJsonPayload("Done.", json)).toBe(json);
  });
});

describe("extractLastProductJson", () => {
  it("skips an earlier example object and takes the fragment", () => {
    const raw = `example { "foo": 1 } then ${JSON.stringify({
      schema: "context-fragment.v1",
      brief: "点题",
      正文: { x: 1 },
    })}`;
    const parsed = extractLastProductJson(raw) as { brief?: string };
    expect(parsed?.brief).toBe("点题");
    expect(tryParseJsonDoc(raw)).toMatchObject({ brief: "点题" });
  });
});
