/**
 * 文风库 → 提示词块（由 libraries 注册表按节点绑定调用）。
 */

import {
  listActiveStylePacks,
  type StylePackEntry,
} from "./store.js";

export function formatStylePackCatalogForPrompt(
  entries?: StylePackEntry[],
): string {
  const packs = (entries ?? listActiveStylePacks()).filter((e) =>
    e.content.trim(),
  );
  if (!packs.length) return "";

  const blocks = packs.map((p, i) => {
    const body = p.content.trim();
    const clipped =
      body.length > 2400 ? `${body.slice(0, 2400)}\n…（已截断）` : body;
    return `### ${i + 1}. ${p.name.trim()}\n\n${clipped}`;
  });

  return `## 【文风库 · 可选用】

跨卡「怎么写」包。用户点名、贴样本对上、或明确「用库里某某」时：优先据此落成本步产物里「怎么写」的部分，再按本局美学微调；不要重做文风问卷。
库内只规定遣词/示范/笔墨/禁忌/写法档；不写世界观与推进。无匹配则照常追问，勿强行套用。

${blocks.join("\n\n")}`;
}
