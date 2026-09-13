import { mkdir, rmdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Directory creation is exclusive across the local server and independent CLI processes. */
export async function withFileLock<T>(file: string, action: () => Promise<T>, timeoutMs = 5000): Promise<T> {
  const lock = `${file}.lock`;
  await mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { await mkdir(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`Content file is locked: ${file}. If its writer crashed, remove ${lock} after verifying no writer is running.`);
      await delay(30);
    }
  }
  try { return await action(); }
  finally { await rmdir(lock); }
}
