import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<AbortSignal>();

export function runWithAbortSignal<T>(
  signal: AbortSignal,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(signal, fn);
}

export function currentAbortSignal(): AbortSignal | undefined {
  return storage.getStore();
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  if (name === "AbortError") return true;
  const message = "message" in err ? String(err.message) : "";
  return /aborted|AbortError/i.test(message);
}

export function throwIfAborted(signal?: AbortSignal): void {
  const active = signal ?? currentAbortSignal();
  if (!active?.aborted) return;
  const err = new Error("This operation was aborted");
  err.name = "AbortError";
  throw err;
}
