import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

/**
 * Node's single executable application format: a blob built from a configuration file, injected
 * into a copy of the Node binary next to a sentinel string that the runtime looks for at start.
 *
 * `useCodeCache` and `useSnapshot` stay off. Both bake V8 state for the machine that generated them,
 * which would make the blob platform specific and stop one build producing both executables. The
 * cost is a slightly slower start, which a server pays once.
 */

const run = promisify(execFile);
const require_ = createRequire(import.meta.url);

/** The string postject overwrites. Node documents this exact value; it is not ours to choose. */
export const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
export const SEA_RESOURCE = "NODE_SEA_BLOB";

export interface SeaConfig {
  main: string;
  output: string;
  disableExperimentalSEAWarning: true;
  useSnapshot: false;
  useCodeCache: false;
  assets: Record<string, string>;
}

export function seaConfig(main: string, output: string, assets: Record<string, string>): SeaConfig {
  return { main, output, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets };
}

/** Builds the blob with the running Node, which is why the binaries downloaded must be its version. */
export async function writeSeaBlob(configPath: string, config: SeaConfig): Promise<string> {
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await run(process.execPath, ["--experimental-sea-config", configPath], { maxBuffer: 64 * 1024 * 1024 });
  return config.output;
}

export async function injectSeaBlob(executable: string, blob: string): Promise<void> {
  const { inject } = require_("postject") as {
    inject(filename: string, resourceName: string, resourceData: Buffer, options: { sentinelFuse: string }): Promise<void>;
  };
  await inject(executable, SEA_RESOURCE, await readFile(blob), { sentinelFuse: SEA_FUSE });
}

/**
 * The Windows binary nodejs.org publishes is signed, and injecting into it leaves a signature that
 * no longer matches. Removing it first is tidier. `signtool` ships with the Windows SDK and is
 * usually absent, so this reports what it did and never stops a build: the release executable is
 * unsigned either way.
 */
export async function removeSignature(executable: string, log: (message: string) => void): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    await run("signtool", ["remove", "/s", executable]);
    log(`signtool removed the signature from ${executable}`);
    return true;
  } catch {
    log("signtool is not on PATH, so the Authenticode signature was left in place. The release executable is unsigned and SmartScreen will warn about it.");
    return false;
  }
}
