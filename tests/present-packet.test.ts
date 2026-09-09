import { describe, expect, it } from "vitest";
import {
  isPresentLikeObject,
  parsePresentPacket,
  parseShellAdaptationFromReplyFormat,
  presentFromPlainText,
  presentOutputFromFallback,
  isPlayFinalVisibleWorker,
  isPlayGmBodyWorker,
  isPlayPresentWorker,
  shellDefaultRegions,
} from "../src/skills/present-packet.js";

describe("present.v1", () => {
  it("parses present packet with blocks", () => {
    const view = parsePresentPacket(
      JSON.stringify({
        schema: "present.v1",
        shell: "chat_monitor",
        blocks: {
          monitor: { 好感: "暖络" },
          body: "她回了一句短谢。",
        },
        meta: { suggested_actions: ["回一句关心"] },
      }),
    );
    expect(view.ok).toBe(true);
    expect(view.fallbackPlain).toBe(false);
    expect(view.packet.shell).toBe("chat_monitor");
    expect(view.packet.blocks.body).toContain("短谢");
    expect(view.packet.meta?.suggested_actions?.[0]).toBe("回一句关心");
  });

  it("falls back plain text to prose body", () => {
    const view = parsePresentPacket("林晚点头收下了画册。");
    expect(view.fallbackPlain).toBe(true);
    expect(view.packet.shell).toBe("prose");
    expect(view.packet.blocks.body).toContain("画册");
  });

  it("does not treat settlement as present", () => {
    const view = parsePresentPacket(
      JSON.stringify({
        schema: "settlement.v1",
        visible_now: "场面",
        player_action: "送礼",
      }),
    );
    expect(view.fallbackPlain).toBe(true);
    expect(isPresentLikeObject({ schema: "settlement.v1" })).toBe(false);
  });

  it("presentFromPlainText helper", () => {
    const p = presentFromPlainText("hello", "chapter_reader");
    expect(p.shell).toBe("chapter_reader");
    expect(p.blocks.body).toBe("hello");
  });

  it("strips 输出.用户展示 heading from plain body", () => {
    const view = parsePresentPacket("### 输出.用户展示\n\n叮！账户来了。");
    expect(view.packet.blocks.body).toBe("叮！账户来了。");
    expect(String(view.packet.blocks.body)).not.toContain("用户展示");
  });

  it("strips heading then parses present JSON", () => {
    const view = parsePresentPacket(
      '### 输出.用户展示\n\n{"schema":"present.v1","shell":"prose","blocks":{"body":"场面很长"}}',
    );
    expect(view.fallbackPlain).toBe(false);
    expect(view.packet.blocks.body).toBe("场面很长");
  });

  it("strips heading inside blocks.body", () => {
    const view = parsePresentPacket(
      JSON.stringify({
        schema: "present.v1",
        shell: "prose",
        blocks: { body: "### 输出.用户展示\n正文" },
      }),
    );
    expect(view.packet.blocks.body).toBe("正文");
  });
});

describe("shell adaptation from reply-format", () => {
  it("reads 呈现壳 from context-fragment", () => {
    const adapt = parseShellAdaptationFromReplyFormat(
      JSON.stringify({
        schema: "context-fragment.v1",
        技能: "正文组成",
        正文: {
          呈现壳: {
            shell_id: "turn_panel",
            为何选它: "机制重",
            微调: {
              tone_chrome: "terminal",
              show_suggested_actions: true,
              block_labels: { body: "场面" },
            },
          },
          可见块: [{ 块id: "body", 区域: "body" }],
        },
      }),
    );
    expect(adapt?.shell_id).toBe("turn_panel");
    expect(adapt?.tweaks.tone_chrome).toBe("terminal");
    expect(adapt?.tweaks.block_labels?.body).toBe("场面");
    expect(shellDefaultRegions("turn_panel")).toContain("footer");
  });

  it("defaults missing shell to prose", () => {
    const adapt = parseShellAdaptationFromReplyFormat(
      JSON.stringify({
        schema: "context-fragment.v1",
        正文: { 可见块: [{ 块id: "body" }] },
      }),
    );
    expect(adapt?.shell_id).toBe("prose");
  });
});

describe("play present worker", () => {
  it("structured present only for narrator / round-present", () => {
    expect(isPlayPresentWorker("narrator")).toBe(true);
    expect(isPlayPresentWorker("round-present")).toBe(true);
    expect(isPlayPresentWorker("world-simulator")).toBe(false);
  });

  it("gm body worker and final visible roles", () => {
    expect(isPlayGmBodyWorker("world-simulator")).toBe(true);
    expect(isPlayGmBodyWorker("narrator")).toBe(false);
    expect(
      isPlayFinalVisibleWorker("world-simulator", { narratorEnabled: false }),
    ).toBe(true);
    expect(
      isPlayFinalVisibleWorker("world-simulator", { narratorEnabled: true }),
    ).toBe(false);
    expect(
      isPlayFinalVisibleWorker("narrator", { narratorEnabled: true }),
    ).toBe(true);
  });

  it("fallback packet uses the given shell", () => {
    const raw = presentOutputFromFallback("她点了点头。", "chat_monitor");
    const view = parsePresentPacket(raw, "prose");
    expect(view.packet.shell).toBe("chat_monitor");
    expect(view.packet.blocks.body).toBe("她点了点头。");
  });
});
