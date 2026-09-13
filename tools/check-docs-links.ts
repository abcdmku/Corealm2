/**
 * Fails the guide build on a link, anchor, or asset the published site does not contain.
 *
 * The guide is generated, so a broken reference is never a typo someone will notice in review: it
 * is a base path off by one directory, or a capture that tools/capture-docs.ts never took, applied
 * uniformly across hundreds of pages. This walks the built output the way a browser would.
 *
 * Usage: npx tsx tools/check-docs-links.ts [--dist dist]
 */
import path from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { argValue, repoRoot } from "./lib/paths.js";

const reference = /(?:href|src)="([^"]+)"/g;
const identifier = /\sid="([^"]+)"/g;
const asset = /\.(?:webp|png|jpe?g|svg|gif|json|js|css|woff2?|ico|xml|txt)$/;
const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

interface Problem {
  page: string;
  reference: string;
  reason: string;
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return full.endsWith(".html") ? [full] : [];
  });
}

/** Mirrors static hosting: `/game/items/` serves `game/items/index.html`. */
function resolvePage(dist: string, urlPath: string): string | undefined {
  const relative = decodeURIComponent(urlPath).replace(/^\//, "");
  for (const candidate of [
    path.join(dist, relative, "index.html"),
    path.join(dist, relative),
    path.join(dist, `${relative}.html`),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

export function checkDocsLinks(dist: string, base = "/"): { pages: number; problems: Problem[] } {
  const basePath = `/${base.split("/").filter(Boolean).join("/")}`.replace(/\/$/, "");
  if (!existsSync(dist)) throw new Error(`No built site at ${dist}. Run npm run docs:build first.`);
  const pages = htmlFiles(dist);
  const ids = new Map<string, Set<string>>();
  for (const file of pages) {
    ids.set(file, new Set([...readFileSync(file, "utf8").matchAll(identifier)].map((match) => match[1]!)));
  }

  const problems: Problem[] = [];
  for (const file of pages) {
    const html = readFileSync(file, "utf8");
    const pageUrl = `${basePath}/${path.relative(dist, file).split(path.sep).join("/").replace(/index\.html$/, "")}`;
    for (const match of html.matchAll(reference)) {
      const raw = match[1]!;
      if (raw === "" || external.test(raw)) continue;
      if (raw.startsWith("#")) {
        const anchor = decodeURIComponent(raw.slice(1));
        if (anchor && !ids.get(file)!.has(anchor)) {
          problems.push({ page: pageUrl, reference: raw, reason: "no element with that id on this page" });
        }
        continue;
      }
      const [target = "", hash] = raw.split("#");
      const resolved = new URL(target || ".", `http://docs.local${pageUrl}`).pathname;
      if (basePath && resolved !== basePath && !resolved.startsWith(`${basePath}/`)) {
        problems.push({ page: pageUrl, reference: raw, reason: "reference is outside the docs base path" });
        continue;
      }
      // Astro emits files relative to dist, without the deployment mount point.
      const localPath = resolved.slice(basePath.length) || "/";
      if (asset.test(localPath)) {
        if (!existsSync(path.join(dist, decodeURIComponent(localPath).replace(/^\//, "")))) {
          problems.push({ page: pageUrl, reference: raw, reason: "asset is not in the build" });
        }
        continue;
      }
      const targetFile = resolvePage(dist, localPath);
      if (!targetFile) {
        problems.push({ page: pageUrl, reference: raw, reason: "no such page" });
        continue;
      }
      if (hash && !ids.get(targetFile)!.has(decodeURIComponent(hash))) {
        problems.push({ page: pageUrl, reference: raw, reason: "target page has no element with that id" });
      }
    }
  }

  const unique = [...new Map(problems.map((problem) =>
    [`${problem.page} ${problem.reference}`, problem])).values()];
  return { pages: pages.length, problems: unique };
}

function main(): void {
  const dist = path.resolve(repoRoot, argValue(process.argv, "--dist") ?? "dist");
  const { pages, problems: unique } = checkDocsLinks(dist, process.env.DOCS_BASE ?? "/");
  if (unique.length > 0) {
    for (const problem of unique.slice(0, 40)) {
      console.error(`  ${problem.page} -> ${problem.reference}  (${problem.reason})`);
    }
    if (unique.length > 40) console.error(`  ...and ${unique.length - 40} more`);
    throw new Error(`${unique.length} broken reference(s) across ${pages} built pages.`);
  }
  console.log(`Checked ${pages} pages: every link, anchor, and asset resolves.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
