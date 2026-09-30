/**
 * 嗅探到的型号列表。只放 sessionStorage，并绑在本次服务进程的 bootId 上。
 * 关掉页面或重启程序后 bootId 对不上，缓存作废，不会留到下一次启动。
 */

const STORAGE_KEY = "wa-model-sniff-v1";

function emptyStore(bootId) {
  return { bootId, entries: {} };
}

function readStore(bootId) {
  if (!bootId) return emptyStore("");
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || parsed.bootId !== bootId || !parsed.entries || typeof parsed.entries !== "object") {
      return emptyStore(bootId);
    }
    return { bootId, entries: parsed.entries };
  } catch {
    return emptyStore(bootId);
  }
}

/** @param {string} bootId @param {string} cacheKey */
export function readSniffModels(bootId, cacheKey) {
  if (!bootId || !cacheKey) return [];
  const raw = readStore(bootId).entries[cacheKey];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => typeof item === "string" && item.trim());
}

/**
 * 写入会丢掉其他 bootId 的条目。
 * @param {string} bootId
 * @param {string} cacheKey
 * @param {string[]} models
 */
export function writeSniffModels(bootId, cacheKey, models) {
  if (!bootId || !cacheKey) return false;
  const store = readStore(bootId);
  store.entries[cacheKey] = models;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}
