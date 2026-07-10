/** 总管/历史命名与 skill 包内 worker id 的映射 */
const WORKER_ALIASES: Record<string, string> = {
  "rules-worker": "write-rules",
  "outline-worker": "outline",
  "drafting-worker": "drafting",
};

export function resolveWorkerId(workerId: string): string {
  return WORKER_ALIASES[workerId] ?? workerId;
}
