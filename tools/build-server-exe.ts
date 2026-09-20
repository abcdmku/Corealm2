import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { repoRoot } from "./lib/paths.js";
import { bundleServer, forbiddenPackages } from "./server-exe/bundle.js";
import { stageAssets } from "./server-exe/assets.js";
import { executableName, nodeBinary, TARGETS, type Target } from "./server-exe/nodeBinary.js";
import { injectSeaBlob, removeSignature, seaConfig, writeSeaBlob } from "./server-exe/sea.js";

/**
 * `npm run server:build`: the Windows and Linux game server executables.
 *
 *   1. esbuild bundles `tools/multiplayer-server.ts` to one CommonJS file.
 *   2. The world pack, the devdocs server-mode build, the seed catalog, the asset manifest and a
 *      build record are staged as SEA assets.
 *   3. `node --experimental-sea-config` turns the bundle and the assets into one blob.
 *   4. The official Node binary of this exact version is downloaded for each target, verified
 *      against that release's SHASUMS256.txt, copied, and the blob is injected with postject.
 *
 * Build the admin UI first. `npm run guide:build` empties `dist/`, so run it before this, not after.
 *
 *   npm run devdocs:build:server
 *   npm run server:build
 *
 * Options:
 *   --targets win-x64,linux-x64   Which executables to produce. Default: both.
 *   --version <name>              What `--version` reports. Default: the tag, then package.json.
 *   --out <dir>                   Default: dist/server.
 *   --cache <dir>                 Verified Node binaries. Default: .cache/node-binaries.
 *   --admin-ui <dir>              Default: dist/devdocs-server.
 *   --forbid a,b                  Packages the bundle may not contain. Defaults to FORBIDDEN below.
 *   --allow-forbidden             Build anyway. For looking at a bundle, never for a release.
 *   --bundle-only                 Stop after the bundle and the asset report.
 */

/**
 * The server boots from the baked world pack, so the renderer's mesh library and the GLB reader have
 * no business in it. `tests/server-import-graph.test.ts` forbids the same set at the source level;
 * this is the same rule applied to what actually came out of the bundler.
 */
const FORBIDDEN = ["three", "@gltf-transform/core", "@gltf-transform/extensions", "@gltf-transform/functions",
  "meshoptimizer", "draco3d", "draco3dgltf", "playwright", "playwright-core", "jsdom", "@recast-navigation/three"];

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const list = (name: string): string[] => (flag(name) ?? "").split(",").map(value => value.trim()).filter(Boolean);

const out = resolve(repoRoot, flag("--out") ?? "dist/server");
const work = join(out, "build");
const cacheDir = resolve(repoRoot, flag("--cache") ?? ".cache/node-binaries");
const adminUiDir = resolve(repoRoot, flag("--admin-ui") ?? "dist/devdocs-server");
const targets = (list("--targets").length ? list("--targets") : [...TARGETS]) as Target[];
for (const target of targets) if (!TARGETS.includes(target)) throw new Error(`Unknown target ${target}. Choose from ${TARGETS.join(", ")}.`);
const forbid = args.includes("--allow-forbidden") ? [] : list("--forbid").length ? list("--forbid") : FORBIDDEN;

const packageVersion = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")).version as string;
const version = flag("--version") ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined) ?? packageVersion;

const log = (message: string): void => { process.stdout.write(`${message}\n`); };
const mib = (bytes: number): string => `${(bytes / 1_048_576).toFixed(2)} MiB`;

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });

log(`bundling tools/multiplayer-server.ts`);
const bundlePath = join(work, "server.cjs");
const bundle = await bundleServer(join(repoRoot, "tools/multiplayer-server.ts"), bundlePath, repoRoot);
log(`bundle ${mib(bundle.bytes)} from ${bundle.inputs.length} modules`);
log("largest in the bundle:");
for (const module of bundle.modules.slice(0, 12)) log(`  ${mib(module.bytes).padStart(10)}  ${module.name}`);
const present = forbiddenPackages(bundle, forbid);
if (present.length) {
  throw new Error(`The bundle contains ${present.join(", ")}, which a server release may not.\n`
    + "The server boots from the world pack. Find the import with: npx vitest run tests/server-import-graph.test.ts");
}

const { assets, build } = await stageAssets({ root: repoRoot, stageDir: join(work, "assets"), adminUiDir, version, log });
log("assets:");
for (const asset of assets) log(`  ${mib(asset.bytes).padStart(10)}  ${asset.name}  <- ${asset.from}`);

const blob = join(work, "server.blob");
await writeSeaBlob(join(work, "sea-config.json"),
  seaConfig(bundlePath, blob, Object.fromEntries(assets.map(asset => [asset.name, asset.path]))));
log(`blob ${mib((await readFile(blob)).length)}`);

if (args.includes("--bundle-only")) {
  log(`stopped after the blob. ${work}`);
} else {
  await mkdir(out, { recursive: true });
  const built: { name: string; path: string }[] = [];
  for (const target of targets) {
    const source = await nodeBinary({ version: process.versions.node, target, cacheDir, log });
    const name = executableName(target);
    const path = join(out, name);
    await copyFile(source, path);
    if (target === "win-x64") await removeSignature(path, log);
    await injectSeaBlob(path, blob);
    if (target === "linux-x64") await chmod(path, 0o755);
    log(`${name} ${mib((await readFile(path)).length)}`);
    built.push({ name, path });
  }
  // What a release publishes beside the executables, so an operator can check what they downloaded.
  await copyFile(join(repoRoot, "deploy/corealm-server.service"), join(out, "corealm-server.service"));
  const sums: string[] = [];
  for (const { name, path } of [...built, { name: "corealm-server.service", path: join(out, "corealm-server.service") }]) {
    sums.push(`${createHash("sha256").update(await readFile(path)).digest("hex")}  ${name}`);
  }
  await writeFile(join(out, "SHA256SUMS"), `${sums.join("\n")}\n`, "utf8");
  await writeFile(join(out, "build-info.json"), `${JSON.stringify(build, null, 2)}\n`, "utf8");
  log(`\n${out}`);
  for (const line of sums) log(`  ${line}`);
}
