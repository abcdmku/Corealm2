import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/*
  One-off codemod for the last two hand-drawn controls:

    <div className="segmented" role="group" …>                 →  <div role="group" className={SEGMENTED} …>
      <button className={c ? "is-active" : ""} aria-pressed…>  →  <Button variant="segment" size="xs" aria-pressed={c} …>
    <label className="search-field[ x]"[ style]><Search …/><input …
                                                               →  <InputGroup className="w-60 x"><InputGroupAddon align="start"><Search /></InputGroupAddon><InputGroupInput …

    npx tsx tools/devdocs-codemod-controls.ts [--write]
*/

const root = path.resolve("devdocs/src");
const write = process.argv.includes("--write");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
});

function ensureImport(source: string, file: string, names: string[], target: string): string {
  const relative = path.relative(path.dirname(file), path.join(root, target)).split(path.sep).join("/");
  const specifier = relative.startsWith(".") ? relative : `./${relative}`;
  const pattern = new RegExp(`import \\{([^}]*)\\} from "${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}";`);
  const existing = pattern.exec(source);
  if (existing) {
    const merged = [...new Set([...existing[1]!.split(",").map(name => name.trim()).filter(Boolean), ...names])];
    return source.replace(existing[0], `import { ${merged.join(", ")} } from "${specifier}";`);
  }
  const lastImport = [...source.matchAll(/^import [^;]+;$/gm)].at(-1);
  const at = lastImport ? lastImport.index! + lastImport[0].length : 0;
  return `${source.slice(0, at)}\nimport { ${names.join(", ")} } from "${specifier}";${source.slice(at)}`;
}

let total = 0;
for (const file of walk(root)) {
  if (file.includes(`${path.sep}components${path.sep}ui${path.sep}`)) continue;
  let text = readFileSync(file, "utf8");
  let count = 0;
  const needs = new Set<string>();

  // Segmented groups: rewrite the container, then every is-active button inside it.
  const groupOpen = /<(div|span) className="segmented"( role="group")?/g;
  for (let match = groupOpen.exec(text); match; match = groupOpen.exec(text)) {
    const tag = match[1]!;
    const start = match.index;
    const end = text.indexOf(`</${tag}>`, groupOpen.lastIndex);
    if (end < 0) continue;
    let inner = text.slice(groupOpen.lastIndex, end);
    inner = inner.replace(/<button([^>]*?)\sclassName=\{([^{}]+?) \? "is-active" : ""\}([^>]*)>([\s\S]*?)<\/button>/g, (_all, before: string, condition: string, after: string, body: string) => {
      let attributes = `${before}${after}`.replace(/\stype="button"/, "");
      if (!/aria-pressed=/.test(attributes)) attributes += ` aria-pressed={${condition.trim()}}`;
      needs.add("Button");
      return `<Button variant="segment" size="xs"${attributes}>${body}</Button>`;
    });
    const replacement = `<${tag} role="group" className="inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-card p-0.5"`;
    text = text.slice(0, start) + replacement + inner.replace(/^/, "") + text.slice(end);
    // Re-attach the rest of the original opening tag (attributes after role) and the close.
    groupOpen.lastIndex = start + replacement.length;
    count++;
  }

  // Search fields.
  const search = /<label className="search-field((?: [\w-]+)*)"(?: style=\{\{[^}]*\}\})?>\s*<Search size=\{\d+\} \/>(?:<span className="sr-only">[^<]*<\/span>)?\s*<input\b/g;
  for (let match = search.exec(text); match; match = search.exec(text)) {
    const extra = match[1]!.trim();
    const close = text.indexOf("</label>", search.lastIndex);
    if (close < 0) continue;
    const styleWidth = /style=\{\{ width: "100%" \}\}/.test(match[0]) ? "w-full" : "w-60";
    const open = `<InputGroup className="${[styleWidth, extra].filter(Boolean).join(" ")}"><InputGroupAddon align="start"><Search /></InputGroupAddon><InputGroupInput`;
    text = text.slice(0, match.index) + open + text.slice(search.lastIndex, close) + "</InputGroup>" + text.slice(close + "</label>".length);
    search.lastIndex = match.index + open.length;
    needs.add("InputGroup"); needs.add("InputGroupAddon"); needs.add("InputGroupInput");
    count++;
  }

  if (!count) continue;
  text = ensureImport(text, file, [...needs], "components/ui/index.js");
  total += count;
  console.log(`${path.relative(root, file)}: ${count}`);
  if (write) writeFileSync(file, text);
}
console.log(`${total} rewrites${write ? "" : " (dry run; pass --write)"}`);
