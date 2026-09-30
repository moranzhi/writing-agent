/**
 * API 配置使用记录（浏览器 localStorage）。
 * 对话菜单与设置页共用：只把「曾经选用过」的模型放进快捷列表。
 */

export const API_PROFILE_USAGE_KEY = "wa-api-profile-usage";

/** @typedef {{ count: number, lastUsed: number }} ApiProfileUsageEntry */
/** @typedef {Record<string, ApiProfileUsageEntry>} ApiProfileUsageMap */

/** @returns {ApiProfileUsageMap} */
export function loadApiProfileUsage() {
  try {
    const raw = localStorage.getItem(API_PROFILE_USAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** @param {ApiProfileUsageMap} usage */
export function saveApiProfileUsage(usage) {
  try {
    localStorage.setItem(API_PROFILE_USAGE_KEY, JSON.stringify(usage));
  } catch {
    /* ignore quota / private mode */
  }
}

/** 选用成功后记一次；首次出现记 count=1。 */
export function recordApiProfileUsage(id) {
  if (!id) return;
  const usage = loadApiProfileUsage();
  const prev = usage[id];
  usage[id] = {
    count: (prev?.count || 0) + 1,
    lastUsed: Date.now(),
  };
  saveApiProfileUsage(usage);
}

/**
 * 当前生效配置若还没有记录，写入一条（不刷 count）。
 * @param {string | null | undefined} id
 */
export function seedApiProfileUsage(id) {
  if (!id) return;
  const usage = loadApiProfileUsage();
  if (usage[id]) return;
  usage[id] = { count: 1, lastUsed: Date.now() };
  saveApiProfileUsage(usage);
}

/** 只去掉快捷列表里的曾用记录，不删除配置本身。 */
export function forgetApiProfileUsage(id) {
  if (!id) return false;
  const usage = loadApiProfileUsage();
  if (!usage[id]) return false;
  delete usage[id];
  saveApiProfileUsage(usage);
  return true;
}

/** @param {Set<string>} validIds */
export function pruneApiProfileUsage(validIds) {
  const usage = loadApiProfileUsage();
  let changed = false;
  for (const id of Object.keys(usage)) {
    if (!validIds.has(id)) {
      delete usage[id];
      changed = true;
    }
  }
  if (changed) saveApiProfileUsage(usage);
}

/**
 * @param {string} id
 * @param {ApiProfileUsageMap} usage
 */
export function apiProfileUsageRank(id, usage) {
  const entry = usage[id];
  return {
    lastUsed: entry?.lastUsed || 0,
    count: entry?.count || 0,
  };
}

/** @param {{ lastUsed: number, count: number }} a @param {{ lastUsed: number, count: number }} b */
export function compareApiProfileUsage(a, b) {
  if (b.lastUsed !== a.lastUsed) return b.lastUsed - a.lastUsed;
  if (b.count !== a.count) return b.count - a.count;
  return 0;
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => { lastUsed: number, count: number }} rankOf
 */
export function sortByApiProfileUsage(items, rankOf) {
  return items
    .map((item, index) => ({ item, index, rank: rankOf(item) }))
    .sort((a, b) => compareApiProfileUsage(a.rank, b.rank) || a.index - b.index)
    .map((entry) => entry.item);
}

/**
 * 组内成员：只留曾用过的；当前生效始终保留。
 * @param {Array<{ id: string }>} members
 * @param {ApiProfileUsageMap} usage
 * @param {string | null | undefined} activeId
 */
export function filterUsedApiProfiles(members, usage, activeId) {
  const used = members.filter(
    (profile) => profile.id === activeId || Boolean(usage[profile.id]),
  );
  return sortByApiProfileUsage(used, (profile) =>
    apiProfileUsageRank(profile.id, usage),
  );
}

/**
 * @param {Array<{ id: string }>} members
 * @param {ApiProfileUsageMap} usage
 */
export function membersUsageRank(members, usage) {
  return members.reduce(
    (acc, profile) => {
      const rank = apiProfileUsageRank(profile.id, usage);
      return {
        lastUsed: Math.max(acc.lastUsed, rank.lastUsed),
        count: acc.count + rank.count,
      };
    },
    { lastUsed: 0, count: 0 },
  );
}
