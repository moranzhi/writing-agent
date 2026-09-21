import { describe, expect, it } from "vitest";
import { Blackboard } from "../src/blackboard/blackboard.js";
import {
  lookupValueMapContent,
  parseValueMapDoc,
  reprojectValueMaps,
  serializeValueMapDoc,
  upsertValueMapEntry,
  removeValueMapEntry,
  VALUE_MAP_TAG,
} from "../src/skills/value-map.js";
import {
  parseVariableCatalog,
  seedVariablesFromCatalog,
  serializeVariableCatalog,
  upsertVariableField,
  removeVariableField,
  VARIABLE_CATALOG_TAG,
} from "../src/skills/variable-catalog.js";
import { stringifyTableDoc, createTableFromValues, parseTableDoc } from "../src/blackboard/table-cells.js";

describe("variable-catalog", () => {
  it("upserts fields and seeds empty 变量.当前", () => {
    let doc = null as ReturnType<typeof parseVariableCatalog>;
    const a = upsertVariableField(doc, {
      key: "好感",
      type: "number",
      initial: 10,
      user_visible: true,
    });
    expect(a.error).toBeUndefined();
    const b = upsertVariableField(a.doc, {
      key: "地点",
      type: "string",
      initial: "旧港",
      user_visible: false,
    });
    const raw = serializeVariableCatalog(b.doc);
    const parsed = parseVariableCatalog(raw);
    expect(parsed?.fields).toHaveLength(2);
    expect(parsed?.fields.find((f) => f.key === "地点")?.user_visible).toBe(false);

    const seeded = seedVariablesFromCatalog({
      catalogRaw: raw,
      currentRaw: null,
      initialRaw: null,
    });
    expect(seeded.seededKeys).toEqual(expect.arrayContaining(["好感", "地点"]));
    expect(seeded.current).toContain("好感");
    expect(seeded.initial).toContain("旧港");
  });

  it("removes a catalog field", () => {
    const a = upsertVariableField(null, { key: "好感", type: "number", initial: 1 });
    const b = upsertVariableField(a.doc, { key: "章节", type: "number", initial: 1 });
    const { doc, error } = removeVariableField(b.doc, "好感");
    expect(error).toBeUndefined();
    expect(doc.fields.map((f) => f.key)).toEqual(["章节"]);
    expect(removeVariableField(doc, "好感").error).toMatch(/无字段/);
  });
});

describe("value-map", () => {
  it("looks up range bands (min inclusive, max exclusive)", () => {
    const { doc } = upsertValueMapEntry(null, {
      id: "aff",
      field: "好感",
      target_tag: "上下文.角色态度",
      bands: [
        { min: 0, max: 30, content: "冷淡" },
        { min: 30, max: 60, content: "熟悉" },
        { min: 60, content: "恋爱" },
      ],
    });
    const entry = doc.maps[0]!;
    expect(lookupValueMapContent(entry, 0)).toBe("冷淡");
    expect(lookupValueMapContent(entry, 29)).toBe("冷淡");
    expect(lookupValueMapContent(entry, 30)).toBe("熟悉");
    expect(lookupValueMapContent(entry, 60)).toBe("恋爱");
  });

  it("reprojects target tag when 变量.当前 changes", () => {
    const board = new Blackboard();
    const { doc } = upsertValueMapEntry(null, {
      id: "aff",
      field: "好感",
      target_tag: "上下文.角色态度",
      bands: [
        { min: 0, max: 50, content: "档A" },
        { min: 50, content: "档B" },
      ],
    });
    board.write({
      tag: VALUE_MAP_TAG,
      content: serializeValueMapDoc(doc),
      source: "test",
    });
    const tableRaw = stringifyTableDoc(
      createTableFromValues({ ["好感"]: 20 }, "test"),
    );
    board.write({
      tag: "变量.当前",
      content: tableRaw,
      source: "test",
    });
    expect(parseTableDoc(board.getContentByTag("变量.当前"))?.rows.map((r) => r.key)).toEqual([
      "好感",
    ]);
    const r1 = reprojectValueMaps({ blackboard: board, currentRaw: tableRaw });
    expect(r1.skipped, JSON.stringify(r1)).toEqual([]);
    expect(r1.written[0]?.tag).toBe("上下文.角色态度");
    expect(board.getContentByTag("上下文.角色态度")).toBe("档A");

    const tableRaw2 = stringifyTableDoc(
      createTableFromValues({ ["好感"]: 80 }, "test"),
    );
    board.write({
      tag: "变量.当前",
      content: tableRaw2,
      source: "test",
    });
    reprojectValueMaps({ blackboard: board, currentRaw: tableRaw2 });
    expect(board.getContentByTag("上下文.角色态度")).toBe("档B");
  });

  it("rejects bad target_tag", () => {
    const { error } = upsertValueMapEntry(null, {
      id: "x",
      field: "好感",
      target_tag: "设计.美学纲领",
      bands: [{ content: "no" }],
    });
    expect(error).toMatch(/上下文/);
  });

  it("round-trips parse", () => {
    const raw = serializeValueMapDoc({
      schema: "value-map.v1",
      maps: [
        {
          id: "ch",
          field: "章节",
          target_tag: "大纲.当前章",
          bands: [
            { when: "eq", value: 1, content: "第一章" },
            { when: "default", content: "未定" },
          ],
        },
      ],
    });
    const parsed = parseValueMapDoc(raw);
    expect(parsed?.maps[0]?.bands).toHaveLength(2);
    expect(lookupValueMapContent(parsed!.maps[0]!, 1)).toBe("第一章");
    expect(lookupValueMapContent(parsed!.maps[0]!, 9)).toBe("未定");
  });

  it("removes map by id", () => {
    const { doc: withMap } = upsertValueMapEntry(null, {
      id: "aff",
      field: "好感",
      target_tag: "上下文.角色态度",
      bands: [{ min: 0, content: "冷" }],
    });
    const { doc, removed, error } = removeValueMapEntry(withMap, "aff");
    expect(error).toBeUndefined();
    expect(removed?.id).toBe("aff");
    expect(doc.maps).toHaveLength(0);
    expect(removeValueMapEntry(doc, "aff").error).toMatch(/无 id/);
  });
});

describe("catalog tag constants", () => {
  it("uses stable design tags", () => {
    expect(VARIABLE_CATALOG_TAG).toBe("设计.变量目录");
    expect(VALUE_MAP_TAG).toBe("设计.变量映射");
  });
});
