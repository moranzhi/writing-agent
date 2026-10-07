import { describe, expect, it } from "vitest";
import {
  catalogFieldsFromVariableDesign,
  mergeCatalogFromVariableDesign,
  syncVariableDesignToRuntime,
  VARIABLE_DESIGN_TAG,
} from "../src/skills/variable-design-compile.js";
import {
  parseVariableCatalog,
  VARIABLE_CATALOG_TAG,
} from "../src/skills/variable-catalog.js";
import {
  mergePresentWithProjections,
  parseStatusBarProjectionBindings,
  projectPresentBlocks,
} from "../src/skills/present-project.js";
import { parseReplyDataContract } from "../src/skills/reply-contract.js";
import { parsePresentPacket } from "../src/skills/present-packet.js";
import { createTableFromValues, stringifyTableDoc } from "../src/blackboard/table-cells.js";

const designRaw = JSON.stringify({
  schema: "context-fragment.v1",
  技能: "变量设计与更新规则",
  正文: {
    真值: [
      {
        id: "current_target_name",
        名称: "当前目标",
        类型: "string",
        初始化: { 默认值: "沈清欢" },
        公开性: "public",
      },
      {
        id: "target_dignity",
        名称: "尊严",
        类型: "number",
        初始化: { 默认值: 100 },
        公开性: "public",
      },
      {
        id: "secret_flag",
        名称: "隐藏标记",
        类型: "boolean",
        初始化: { 默认值: false },
        公开性: "hidden",
      },
    ],
  },
});

describe("variable-design-compile", () => {
  it("parses truths into catalog fields", () => {
    const fields = catalogFieldsFromVariableDesign(designRaw);
    expect(fields.map((f) => f.key)).toEqual([
      "current_target_name",
      "target_dignity",
      "secret_flag",
    ]);
    expect(fields.find((f) => f.key === "target_dignity")?.initial).toBe(100);
    expect(fields.find((f) => f.key === "secret_flag")?.user_visible).toBe(false);
  });

  it("merges into an existing catalog without dropping declare fields", () => {
    const existing = parseVariableCatalog(
      JSON.stringify({
        schema: "variable-catalog.v1",
        fields: [
          {
            key: "extra_declared",
            type: "number",
            initial: 1,
            user_visible: true,
          },
        ],
      }),
    );
    const merged = mergeCatalogFromVariableDesign(existing, designRaw)!;
    expect(merged.doc.fields.map((f) => f.key).sort()).toEqual([
      "current_target_name",
      "extra_declared",
      "secret_flag",
      "target_dignity",
    ].sort());
    expect(merged.added).toEqual(
      expect.arrayContaining(["current_target_name", "target_dignity", "secret_flag"]),
    );
  });

  it("syncs design → catalog → 变量.当前", () => {
    const sync = syncVariableDesignToRuntime({
      designRaw,
      catalogRaw: null,
      currentRaw: null,
      initialRaw: null,
    });
    expect(sync.catalog).toContain("current_target_name");
    expect(sync.current).toContain("沈清欢");
    expect(sync.initial).toContain("target_dignity");
    expect(sync.seededKeys).toEqual(
      expect.arrayContaining(["current_target_name", "target_dignity", "secret_flag"]),
    );
    expect(VARIABLE_DESIGN_TAG).toBe("设计.变量设计与更新规则");
    expect(VARIABLE_CATALOG_TAG).toBe("设计.变量目录");
  });

  it("does not overwrite existing current cells when reseeding", () => {
    const first = syncVariableDesignToRuntime({
      designRaw,
      catalogRaw: null,
      currentRaw: null,
      initialRaw: null,
    });
    const patched = createTableFromValues(
      { current_target_name: "已改名", target_dignity: 100, secret_flag: false },
      "user",
    );
    const second = syncVariableDesignToRuntime({
      designRaw,
      catalogRaw: first.catalog,
      currentRaw: stringifyTableDoc(patched),
      initialRaw: first.initial,
    });
    expect(second.current).toBeNull();
  });
});

describe("present-project", () => {
  const replyFormat = JSON.stringify({
    schema: "context-fragment.v1",
    正文: {
      数据契约: {
        schema: "present.v1",
        blocks: {
          status_card: { 类型: "kv", 来源: "program_projection", 职责: "属性" },
          body: { 类型: "markdown", 来源: "model_generated", 职责: "正文" },
        },
      },
      frontend: { html: "<div id='app'></div>", css: "", js: "present.onData(function(){})" },
    },
  });

  const statusBar = JSON.stringify({
    schema: "context-fragment.v1",
    正文: {
      语义区域: [
        {
          id: "status_card",
          内容类型: "kv",
          来源: {
            方式: "program_projection",
            ref: "变量.当前",
            字段: ["current_target_name", "target_dignity"],
          },
        },
      ],
    },
  });

  it("reads projection bindings from status bar", () => {
    const bindings = parseStatusBarProjectionBindings(statusBar);
    expect(bindings).toEqual([
      {
        id: "status_card",
        type: "kv",
        ref: "变量.当前",
        fields: ["current_target_name", "target_dignity"],
      },
    ]);
  });

  it("projects selected fields into program blocks", () => {
    const contract = parseReplyDataContract(replyFormat)!;
    const current = stringifyTableDoc(
      createTableFromValues(
        { current_target_name: "沈清欢", target_dignity: 100, other: 1 },
        "system",
      ),
    );
    const projected = projectPresentBlocks({
      contract,
      statusBarRaw: statusBar,
      currentVarsRaw: current,
    });
    expect(projected.status_card).toEqual({
      current_target_name: "沈清欢",
      target_dignity: 100,
    });
  });

  it("falls back to all current vars when status bar has no binding", () => {
    const contract = parseReplyDataContract(replyFormat)!;
    const current = stringifyTableDoc(
      createTableFromValues({ a: 1, b: "x" }, "system"),
    );
    const projected = projectPresentBlocks({
      contract,
      currentVarsRaw: current,
    });
    expect(projected.status_card).toEqual({ a: 1, b: "x" });
  });

  it("expands JSON-string matrices into table rows for program projection", () => {
    const reply = JSON.stringify({
      schema: "context-fragment.v1",
      正文: {
        数据契约: {
          schema: "present.v1",
          blocks: {
            heroines: { 类型: "table", 来源: "program_projection", 职责: "矩阵" },
            body: { 类型: "markdown", 来源: "model_generated", 职责: "正文" },
          },
        },
        frontend: { html: "<div></div>", css: "", js: "present.onData(function(){})" },
      },
    });
    const status = JSON.stringify({
      schema: "context-fragment.v1",
      正文: {
        语义区域: [
          {
            id: "heroines",
            内容类型: "table",
            来源: {
              方式: "program_projection",
              ref: "变量.当前",
              字段: ["heroines_matrix"],
            },
          },
        ],
      },
    });
    const matrix = {
      塞琳娜: { 认知度: "有所耳闻", 亲密度: -10, 服从度: 10 },
      崔岚: { 认知度: "有所耳闻", 亲密度: -10, 服从度: 10 },
    };
    const current = stringifyTableDoc(
      createTableFromValues(
        { heroines_matrix: JSON.stringify(matrix) },
        "system",
      ),
    );
    const projected = projectPresentBlocks({
      contract: parseReplyDataContract(reply)!,
      statusBarRaw: status,
      currentVarsRaw: current,
    });
    expect(projected.heroines).toEqual({
      source: "heroines_matrix",
      rows: [
        { name: "塞琳娜", 认知度: "有所耳闻", 亲密度: -10, 服从度: 10 },
        { name: "崔岚", 认知度: "有所耳闻", 亲密度: -10, 服从度: 10 },
      ],
    });
  });

  it("merges projections into a plain body present packet", () => {
    const merged = mergePresentWithProjections(
      "一段正文",
      { status_card: { hp: 10 } },
      "prose",
    );
    const view = parsePresentPacket(merged);
    expect(view.packet.blocks.body).toBe("一段正文");
    expect(view.packet.blocks.status_card).toEqual({ hp: 10 });
  });
});
