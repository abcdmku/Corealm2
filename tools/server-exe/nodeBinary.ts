import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

/**
 * The Node binary a release is built on top of.
 *
 * A single executable is the official Node binary with a blob appended, so the binary and the blob
 * have to be the same version: the runtime that reads the blob is the runtime inside the binary.
 * The build uses the version that generated the blob, downloads it from nodejs.org and checks it
 * against that release's `SHASUMS256.txt` before anything is injected into it.
 *
 * Cross building works because the blob is a platform-independent file as long as `useCodeCache`
 * and `useSnapshot` stay off, which is what `sea.ts` asks for.
 */

const run = promisify(execFile);

export type Target = "win-x64" | "linux-x64";
export const TARGETS: readonly Target[] = ["win-x64", "linux-x64"];
export const executableName = (target: Target): string => target === "win-x64" ? "corealm-server-win-x64.exe" : "corealm-server-linux-x64";

/** What `SHASUMS256.txt` calls the file, which is also the path under the release directory. */
const downloadPath = (target: Target, version: string): string =>
  target === "win-x64" ? "win-x64/node.exe" : `node-v${version}-linux-x64.tar.gz`;

export interface NodeBinaryOptions {
  version: string;
  target: Target;
  /** Where verified binaries are kept between builds. Put it on a disk with room; it holds ~120 MB per target. */
  cacheDir: string;
  mirror?: string;
  log?(message: string): void;
}

async function fetchTo(url: string, path: string): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

const sha256 = async (path: string): Promise<string> => createHash("sha256").update(await readFile(path)).digest("hex");

/** The one line of `SHASUMS256.txt` for a file, which is `<sha256>  <name>`. */
export function shasumFor(text: string, name: string): string {
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{64}) {2}(.+?)\s*$/.exec(line);
    if (match && match[2] === name) return match[1]!;
  }
  throw new Error(`SHASUMS256.txt has no entry for ${name}`);
}

/**
 * The verified `node` or `node.exe` for a target, cached. Windows publishes the bare executable;
 * Linux only ships a tarball, so one file is taken out of it with `tar`, which both GNU tar and the
 * bsdtar in Windows understand.
 */
export async function nodeBinary(options: NodeBinaryOptions): Promise<string> {
  const { version, target, cacheDir } = options;
  const log = options.log ?? (() => {});
  const mirror = options.mirror ?? "https://nodejs.org/dist";
  const cached = join(cacheDir, `v${version}`, target === "win-x64" ? "node.exe" : "node");
  if (await stat(cached).then(entry => entry.isFile(), () => false)) { log(`cached ${cached}`); return cached; }
  await mkdir(join(cacheDir, `v${version}`), { recursive: true });

  const name = downloadPath(target, version);
  const sums = await fetch(`${mirror}/v${version}/SHASUMS256.txt`);
  if (!sums.ok) throw new Error(`SHASUMS256.txt for v${version} answered ${sums.status}`);
  const expected = shasumFor(await sums.text(), name);

  // Downloads land beside the cache, not in the system temp directory: a Node tarball is tens of
  // megabytes and the cache is wherever the operator has room.
  const work = await mkdtemp(join(cacheDir, "download-"));
  try {
    const download = join(work, name.split("/").at(-1)!);
    log(`downloading ${mirror}/v${version}/${name}`);
    await fetchTo(`${mirror}/v${version}/${name}`, download);
    const actual = await sha256(download);
    if (actual !== expected) throw new Error(`${name} hashes to ${actual}, and v${version} publishes ${expected}`);
    log(`verified ${name} ${actual}`);
    if (target === "win-x64") await rename(download, cached).catch(async () => { await writeFile(cached, await readFile(download)); });
    else {
      // Names only, resolved from `cwd`: GNU tar reads a Windows `D:\...` argument as a remote host.
      await run("tar", ["-xzf", name, "--strip-components=2", `node-v${version}-linux-x64/bin/node`], { cwd: work });
      await rename(join(work, "node"), cached).catch(async () => { await writeFile(cached, await readFile(join(work, "node"))); });
      await chmod(cached, 0o755);
    }
    return cached;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
