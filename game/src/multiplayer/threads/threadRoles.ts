import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { runDatabaseThread, type DatabaseThreadData } from "./databaseThread.js";
import { runWorldThread, type WorldThreadData } from "./worldThread.js";

/**
 * What a server thread runs. `threadRole` is how the bundled server's entry tells that it was started
 * as a thread; from source the entry is `threadEntry.ts`, which only calls `runThread`.
 *
 * A thread that cannot start throws, which its `Worker` reports to the main thread as an error.
 */
export function threadRole(): "database" | "world" | null {
  const role = isMainThread ? null : (workerData as { role?: unknown } | null)?.role;
  return role === "database" || role === "world" ? role : null;
}
/**
 * `node:sqlite` prints an experimental warning to stderr the first time a thread loads it. A server's
 * output is JSON lines and nothing else, so that one warning is dropped and every other is kept.
 */
export function quietSqliteWarning(): void {
  const listeners = process.listeners("warning");
  process.removeAllListeners("warning");
  process.on("warning", warning => {
    if (warning.name === "ExperimentalWarning" && warning.message.includes("SQLite")) return;
    for (const listener of listeners) listener(warning);
  });
}
export async function runThread(): Promise<void> {
  if (!parentPort) throw new Error("A server thread needs a parent");
  quietSqliteWarning();
  // Neither role reads a content table as it loads. The world installs its catalog before it imports the simulation.
  if (threadRole() === "database") await runDatabaseThread(workerData as DatabaseThreadData, parentPort);
  else if (threadRole() === "world") await runWorldThread(workerData as WorldThreadData, parentPort);
  else throw new Error("Unknown server thread role");
}

