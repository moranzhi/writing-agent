/** 判断 itemTag 是否匹配 worker 声明的 inputTag 模式（精确或 前缀.*） */
export function tagMatchesPattern(itemTag: string, pattern: string): boolean {
  if (pattern === "**") return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return itemTag === prefix || itemTag.startsWith(`${prefix}.`);
  }
  return itemTag === pattern;
}

export function isFullAccessPattern(pattern: string): boolean {
  return pattern === "**";
}
