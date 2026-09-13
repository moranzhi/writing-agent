import { describe, expect, it } from "vitest";
import {
  listSnapshotProducts,
  patchBlackboardTagContent,
} from "../src/book/snapshot-products.js";
import type { BlackboardItem } from "../src/types/blackboard.js";

function item(tag: string, content: string): BlackboardItem {
  const now = "2026-09-13T00:00:00.000Z";
  return {
    id: tag,
    tag,
    content,
    source: "test",
    createdAt: now,
    updatedAt: now,
  };
}

describe("listSnapshotProducts", () => {
  it("orders by creation flow steps then leftovers", () => {
    const flow = JSON.stringify({
      version: 1,
      steps: [
        { id: "a", name: "美学纲领与交互范式", depends_on: [] },
        { id: "b", name: "舞台骨架", depends_on: ["a"] },
      ],
    });
    const rows = listSnapshotProducts([
      item("设计.舞台骨架", "骨架正文"),
      item("设计.美学纲领与交互范式", "美学正文"),
      item("设计.创作流程", flow),
      item("输出.用户展示", "短正文"),
      item("设计.监控栏", "栏"),
    ]);
    expect(rows.map((r) => r.tag)).toEqual([
      "设计.美学纲领与交互范式",
      "设计.舞台骨架",
      "设计.监控栏",
      "输出.用户展示",
    ]);
    expect(rows[0].label).toBe("美学纲领与交互范式");
  });

  it("patches latest tag content", () => {
    const items = [
      item("输出.用户展示", "旧"),
      item("输出.用户展示", "中间"),
    ];
    const next = patchBlackboardTagContent(items, "输出.用户展示", "新加长正文");
    expect(next).toHaveLength(2);
    expect(next[1].content).toBe("新加长正文");
    expect(next[0].content).toBe("旧");
  });
});
