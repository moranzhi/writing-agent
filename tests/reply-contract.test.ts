import { describe, expect, it } from "vitest";
import { parsePresentPacket } from "../src/skills/present-packet.js";
import {
  openingContractError,
  parseReplyDataContract,
  presentSchemaFromContract,
} from "../src/skills/reply-contract.js";

const replyFormat = JSON.stringify({
  schema: "context-fragment.v1",
  正文: {
    数据契约: {
      schema: "present.v1",
      blocks: {
        status_card: { 类型: "kv", 来源: "program_projection", 职责: "属性" },
        body: { 类型: "markdown", 来源: "model_generated", 职责: "主读正文" },
        forum_feed: { 类型: "list", 来源: "model_generated", 职责: "论坛" },
        danmu_stream: { 类型: "list", 来源: "model_generated", 职责: "弹幕" },
      },
    },
    frontend: { html: `<div id="app"></div>`, css: "body{}", js: "present.onData(function(){})" },
  },
});

describe("reply data contract", () => {
  it("keeps model blocks and drops program projections from the fill schema", () => {
    const contract = parseReplyDataContract(replyFormat);
    expect(contract?.modelBlocks.map((block) => block.id)).toEqual([
      "body",
      "forum_feed",
      "danmu_stream",
    ]);
    expect(contract?.programBlocks.map((block) => block.id)).toEqual(["status_card"]);
    expect(contract?.frontend?.html).toContain("app");
    const built = presentSchemaFromContract(contract!);
    const blocks = (
      built.schema.properties as { blocks: { required: string[] } }
    ).blocks;
    expect(blocks.required).toEqual(["body", "forum_feed", "danmu_stream"]);
    expect(built.loose).toBe(false);
  });

  it("rejects an old shell packet that only fills body", () => {
    const contract = parseReplyDataContract(replyFormat)!;
    const error = openingContractError(
      JSON.stringify({
        schema: "present.v1",
        shell: "prose",
        blocks: { body: "清晨，@玩家推开门。" },
      }),
      contract,
    );
    expect(error).toContain("forum_feed");
    expect(error).toContain("danmu_stream");
  });

  it("accepts present.v1 that fills every model block", () => {
    const contract = parseReplyDataContract(replyFormat)!;
    expect(
      openingContractError(
        JSON.stringify({
          schema: "present.v1",
          blocks: {
            body: "清晨，@玩家推开门。",
            forum_feed: ["有人愿意修外墙吗？"],
            danmu_stream: [],
          },
        }),
        contract,
      ),
    ).toBeUndefined();
  });

  it("preserves contract blocks when normalizing a present packet", () => {
    const view = parsePresentPacket(
      JSON.stringify({
        schema: "present.v1",
        blocks: {
          body: "正文",
          forum_feed: ["一帖"],
          danmu_stream: ["一条"],
        },
      }),
    );
    expect(view.packet.blocks.forum_feed).toEqual(["一帖"]);
    expect(view.packet.blocks.danmu_stream).toEqual(["一条"]);
  });
});
