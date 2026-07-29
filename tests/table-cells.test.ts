import { describe, expect, it } from "vitest";
import {
  createTableFromValues,
  mergeTableCells,
  parseTableDoc,
  stringifyTableDoc,
} from "../src/blackboard/table-cells.js";

describe("table-cells", () => {
  it("creates and parses rows with rev", () => {
    const doc = createTableFromValues(
      { 年龄: 20, 资产: "少" },
      "worker:opening-generator",
      { 年龄: { note: "由普通大学生推断" } },
    );
    expect(doc.rows).toHaveLength(2);
    const roundtrip = parseTableDoc(stringifyTableDoc(doc));
    expect(roundtrip?.rows.find((r) => r.key === "年龄")?.value).toBe(20);
    expect(roundtrip?.rows.find((r) => r.key === "年龄")?.note).toContain("大学生");
  });

  it("does not overwrite user-owned cells", () => {
    const current = createTableFromValues({ 年龄: 22 }, "user");
    const patch = createTableFromValues({ 年龄: 18, 资产: 100 }, "worker:opening-generator");
    const { doc, applied, skipped } = mergeTableCells({
      current,
      patch,
      actor: "worker:variable-update",
    });
    expect(skipped.some((s) => s.key === "年龄" && s.reason === "user-owned")).toBe(
      true,
    );
    expect(applied).toContain("资产");
    expect(doc.rows.find((r) => r.key === "年龄")?.value).toBe(22);
    expect(doc.rows.find((r) => r.key === "资产")?.value).toBe(100);
  });

  it("respects expectedRev conflicts", () => {
    const current = createTableFromValues({ 好感: 10 }, "worker:a");
    current.rows[0].rev = 3;
    const patch = createTableFromValues({ 好感: 60 }, "worker:b");
    const { skipped, doc } = mergeTableCells({
      current,
      patch,
      actor: "worker:b",
      expectedRev: { 好感: 2 },
    });
    expect(skipped[0]?.reason).toContain("rev-conflict");
    expect(doc.rows.find((r) => r.key === "好感")?.value).toBe(10);
  });
});
