import { Worker, type TransferListItem } from "node:worker_threads";
import type { DatabaseThreadData } from "./databaseThread.js";
import type { WorldThreadData } from "./worldThread.js";

/**
 * How a server thread is started. The same two roles run from three places, and only the way a
 * `Worker` finds its code differs:
 *
 *  - from source, under tsx or in the test suite: a module file, `threadEntry.ts`;
 *  - from the single executable: there is no file. Node refuses the executable itself as a worker
 *    script, so the bundle is also embedded as an asset and a few lines of bootstrap compile it
 *    inside the worker. The bundle's entry sees it is not the main thread and runs the role instead.
 */
export type ThreadData = DatabaseThreadData | WorldThreadData;
export type ThreadLauncher = (data: ThreadData, transfer: readonly TransferListItem[], name: string) => Worker;

/** Start threads from a module on disk. A TypeScript entry gets tsx's loader unless this process already runs under it. */
export function moduleLauncher(entry: URL): ThreadLauncher {
  const underTsx = process.execArgv.some(argument => argument.includes("tsx"));
  const execArgv = entry.pathname.endsWith(".ts") && !underTsx ? [...process.execArgv.filter(argument => !argument.startsWith("--input-type")), "--import", import.meta.resolve("tsx")] : undefined;
  return (data, transfer, name) => new Worker(entry, { workerData: data, transferList: [...transfer], name, ...(execArgv ? { execArgv } : {}) });
}

/** The asset key the build embeds the bundle under, beside `main`. */
export const SERVER_BUNDLE_ASSET = "server.cjs";
/**
 * Start threads inside the single executable. `compileFunction` rather than a plain `eval` worker:
 * it starts in half the time on a ten megabyte bundle and keeps `server.cjs:line` in stack traces.
 * A worker's `require` is the ordinary one, not the builtin-only one the executable's main script gets.
 */
const SEA_BOOTSTRAP = `
const path = require("node:path");
const source = require("node:sea").getAsset(${JSON.stringify(SERVER_BUNDLE_ASSET)}, "utf8");
const run = require("node:vm").compileFunction(source, ["require", "module", "exports", "__filename", "__dirname"], { filename: ${JSON.stringify(SERVER_BUNDLE_ASSET)} });
const module_ = { exports: {} };
run(require, module_, module_.exports, process.execPath, path.dirname(process.execPath));`;
export function seaLauncher(): ThreadLauncher {
  return (data, transfer, name) => new Worker(SEA_BOOTSTRAP, { eval: true, workerData: data, transferList: [...transfer], name });
}
