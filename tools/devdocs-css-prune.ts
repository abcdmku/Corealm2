import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/*
  Remove CSS selectors that name a class no source file mentions any more.

    npx tsx tools/devdocs-css-prune.ts [--write] [--drop hook-a,hook-b]

  A selector naming a class that never appears in any .ts/.tsx under devdocs/src cannot match, so it
  is dropped from its selector list, and a rule whose list empties is deleted. Nested blocks (@layer,
  @media) are walked. Comments are kept. Run after moving a component to Tailwind to clear what its
  stylesheet no longer styles.
*/

const root = path.resolve("devdocs/src");
const write = process.argv.includes("--write");
/** `--drop a,b`: classes that are now styled in JSX and kept only as hooks; their rules go too. */
const dropIndex = process.argv.indexOf("--drop");
const forced = new Set(dropIndex >= 0 ? (process.argv[dropIndex + 1] ?? "").split(",").filter(Boolean) : []);
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const files = walk(root);
const sources = files.filter(file => /\.(tsx?)$/.test(file)).map(file => readFileSync(file, "utf8")).join("\n");
const used = new Map<string, boolean>();
const isUsed = (name: string): boolean => {
  if (forced.has(name)) return false;
  let known = used.get(name);
  if (known === undefined) {
    known = new RegExp(`(["'\`\\s.{(]|^)${name.replace(/[-]/g, "\\-")}(["'\`\\s:)\\]}$]|$)`, "m").test(sources);
    used.set(name, known);
  }
  return known;
};

/** Returns the pruned text of a block body. */
function prune(text: string, removed: string[]): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      out += text.slice(index, end + 2);
      index = end + 2;
      continue;
    }
    const brace = text.indexOf("{", index);
    const semi = text.indexOf(";", index);
    const comment = text.indexOf("/*", index);
    if (brace < 0) { out += text.slice(index); break; }
    if (comment >= 0 && comment < brace) { out += text.slice(index, comment); index = comment; continue; }
    if (semi >= 0 && semi < brace) { out += text.slice(index, semi + 1); index = semi + 1; continue; }
    const prelude = text.slice(index, brace);
    // Find the matching close brace.
    let depth = 1, cursor = brace + 1;
    while (depth && cursor < text.length) { const char = text[cursor]; if (char === "{") depth++; else if (char === "}") depth--; cursor++; }
    const body = text.slice(brace + 1, cursor - 1);
    const leading = prelude.match(/^\s*/)![0];
    const head = prelude.trim();
    if (head.startsWith("@")) {
      const inner = prune(body, removed);
      if (/^@(media|supports|container)/.test(head) && !inner.replace(/\/\*[\s\S]*?\*\//g, "").trim()) { index = cursor; continue; }
      out += `${leading}${head} {${inner}}`;
    } else {
      const selectors = head.split(",").map(selector => selector.trim()).filter(Boolean);
      const kept = selectors.filter(selector => [...selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)].every(match => isUsed(match[1]!)));
      if (kept.length < selectors.length) removed.push(...selectors.filter(selector => !kept.includes(selector)));
      if (kept.length) out += `${leading}${kept.join(", ")} {${body}}`;
    }
    index = cursor;
  }
  return out;
}

let total = 0, lines = 0;
for (const sheet of files.filter(file => file.endsWith(".css"))) {
  const text = readFileSync(sheet, "utf8");
  const removed: string[] = [];
  const next = prune(text, removed).replace(/\n{3,}/g, "\n\n");
  if (!removed.length) continue;
  total += removed.length;
  lines += text.split("\n").length - next.split("\n").length;
  console.log(`${path.relative(root, sheet)}: ${removed.length} selectors`);
  if (write) writeFileSync(sheet, next);
}
console.log(`${total} dead selectors, ${lines} lines${write ? " removed" : " (dry run; pass --write)"}`);
