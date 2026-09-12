/**
 * Stages the generated Markdown into Starlight's content tree and its media into `public/`.
 *
 * Media is staged once. Every generated page references images through a plain `<img>` against a
 * URL-relative path, so Astro never needs a second copy of `docs/game/assets` beside the Markdown:
 * a tree that used to weigh three copies of the same 40 MB now weighs one.
 */
import path from "node:path";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./lib/paths.js";

const source = path.resolve(repoRoot, "docs/game");
const docsSiteRoot = path.resolve(repoRoot, "docs-site");
const target = path.resolve(docsSiteRoot, "src/content/docs/game");
const assetsSource = path.resolve(source, "assets");
const assetsTarget = path.resolve(docsSiteRoot, "public/game/assets");
const legacyWorldMapTarget = path.resolve(docsSiteRoot, "public/game/locations/assets/world-map.webp");

function assertSafeTarget(): void {
  const relative = path.relative(docsSiteRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error(`Refusing to stage generated docs outside ${docsSiteRoot}: ${target}`);
  }
}

async function main(): Promise<void> {
  assertSafeTarget();
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  // Markdown only: `assets` is the one directory the content collection must not receive, because
  // Astro would then fingerprint and emit a duplicate of every capture already served from public.
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === "assets") continue;
    await cp(path.join(source, entry.name), path.join(target, entry.name), { recursive: true });
  }
  await rename(path.join(target, "README.md"), path.join(target, "index.md"));
  await rm(legacyWorldMapTarget, { force: true });
  await rm(assetsTarget, { recursive: true, force: true });
  await mkdir(path.dirname(assetsTarget), { recursive: true });
  await cp(assetsSource, assetsTarget, { recursive: true });
  console.log(`Staged ${path.relative(repoRoot, source)} in ${path.relative(repoRoot, target)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
