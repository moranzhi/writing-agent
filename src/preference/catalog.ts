/**

 * 偏好库 → 提示词块（由 libraries 注册表按节点绑定调用）。

 */



import {

  ensureStarterPreferences,

  listActivePreferences,

  type PreferenceEntry,

} from "./store.js";



export function formatPreferenceCatalogForPrompt(

  entries?: PreferenceEntry[],

): string {

  ensureStarterPreferences();

  const active = (entries ?? listActivePreferences()).filter((e) =>

    e.content.trim(),

  );

  if (!active.length) return "";



  const lines = active.map((e, i) => `${i + 1}. ${e.content.trim()}`);



  return `## 【偏好库 · 可选用】



跨局硬约束条目（禁区 / 纠偏 / 默认取向等）。用户点名、对齐某条、或明确「本局要进库里某某」时：写入本步产物；可改写为可执行句子，勿整库无脑粘贴。

与文风库分工：本库不管遣词示范，只管「必须遵守 / 绝对不要」。无匹配则照常追问，勿强行套用。



${lines.join("\n")}`;

}


