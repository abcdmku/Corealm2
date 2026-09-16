import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/*
  One-off codemod, the second half of devdocs-codemod-buttons.ts:

    <span className="badge[ badge-mono][ x]" data-tone={t}>…</span>   →  <Badge variant={toneVariant(t)} [className="font-mono x"]>…</Badge>
    <label className="select[ x]"><span className="sr-only">…</span><select …>…</select></label>
                                                                      →  <NativeSelect wrapperClassName="x" …>…</NativeSelect>
    <button … className={`filter-chip${c ? " is-active" : ""}`} …>…</button>
                                                                      →  <Button variant="chip" size="xs" …>…</Button>

    npx tsx tools/devdocs-codemod-primitives.ts [--write]
*/

const root = path.resolve("devdocs/src");
const write = process.argv.includes("--write");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
});

/** Replace an opening tag match and its matching close (no same-tag nesting inside). */
function rewrite(source: string, open: RegExp, tag: string, build: (match: RegExpExecArray) => { open: string; close: string; closeTag?: string } | undefined): { text: string; count: number } {
  let out = "", cursor = 0, count = 0;
  open.lastIndex = 0;
  for (let match = open.exec(source); match; match = open.exec(source)) {
    const built = build(match);
    if (!built) continue;
    const closeTag = built.closeTag ?? `</${tag}>`;
    const close = source.indexOf(closeTag, open.lastIndex);
    if (close < 0) continue;
    out += source.slice(cursor, match.index) + built.open + source.slice(open.lastIndex, close) + built.close;
    cursor = close + closeTag.length;
    open.lastIndex = cursor;
    count++;
  }
  return { text: out + source.slice(cursor), count };
}

function ensureImport(source: string, file: string, names: string[], target: string): string {
  let out = source;
  const relative = path.relative(path.dirname(file), path.join(root, target)).split(path.sep).join("/");
  const specifier = relative.startsWith(".") ? relative : `./${relative}`;
  const existing = new RegExp(`import \\{([^}]*)\\} from "${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}";`).exec(out);
  if (existing) {
    const have = existing[1]!.split(",").map(name => name.trim()).filter(Boolean);
    const merged = [...new Set([...have, ...names])];
    return out.replace(existing[0], `import { ${merged.join(", ")} } from "${specifier}";`);
  }
  const lastImport = [...out.matchAll(/^import [^;]+;$/gm)].at(-1);
  const at = lastImport ? lastImport.index! + lastImport[0].length : 0;
  out = `${out.slice(0, at)}\nimport { ${names.join(", ")} } from "${specifier}";${out.slice(at)}`;
  return out;
}

let total = 0;
for (const file of walk(root)) {
  if (file.includes(`${path.sep}components${path.sep}ui${path.sep}`)) continue;
  let text = readFileSync(file, "utf8");
  const needs = new Set<string>();

  const badges = rewrite(text, /<span\s+(?:key=\{[^}]*\}\s+)?className="badge((?: [\w-]+)*)"((?:\s+(?:data-tone=(?:\{[^}]*\}|"[^"]*")|[\w-]+=(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|"[^"]*")))*)\s*>/g, "span", match => {
    const extra = match[1]!.trim().split(/\s+/).filter(Boolean);
    let attributes = match[2]!;
    const tone = /\sdata-tone=(\{[^}]*\}|"[^"]*")/.exec(attributes);
    attributes = attributes.replace(/\sdata-tone=(\{[^}]*\}|"[^"]*")/, "");
    const key = /^<span\s+(key=\{[^}]*\})/.exec(match[0])?.[1];
    const classes = extra.map(name => name === "badge-mono" ? "font-mono" : name);
    const variant = tone ? (tone[1]!.startsWith("\"") ? `variant=${tone[1]}` : `variant={toneVariant(${tone[1]!.slice(1, -1)})}`) : "";
    if (tone && !tone[1]!.startsWith("\"")) needs.add("toneVariant");
    needs.add("Badge");
    return { open: `<Badge${key ? ` ${key}` : ""}${variant ? ` ${variant}` : ""}${classes.length ? ` className="${classes.join(" ")}"` : ""}${attributes}>`, close: "</Badge>" };
  });
  text = badges.text;

  const selects = rewrite(text, /<label className="select((?: [\w-]+)*)"(?: htmlFor=\{[^}]*\})?>(?:<span className="sr-only">[^<]*<\/span>)?<select\b/g, "select", match => {
    const extra = match[1]!.trim();
    needs.add("NativeSelect");
    return { open: `<NativeSelect${extra ? ` wrapperClassName="${extra}"` : ""}`, close: "</NativeSelect>", closeTag: "</select></label>" };
  });
  text = selects.text;

  const chips = rewrite(text, /<button((?:\s+[\w-]+=(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|"[^"]*"))*?)\s+className=\{`filter-chip\$\{([^`]*?) \? " is-active" : ""\}`\}((?:\s+[\w-]+=(?:\{[^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*\}|"[^"]*"))*)\s*>/g, "button", match => {
    needs.add("Button");
    const attributes = `${match[1]}${match[3]}`.replace(/\stype="button"/, "");
    return { open: `<Button variant="chip" size="xs"${attributes}>`, close: "</Button>" };
  });
  text = chips.text;

  const count = badges.count + selects.count + chips.count;
  if (!count) continue;
  const kit = [...needs].filter(name => name !== "toneVariant");
  if (kit.length) text = ensureImport(text, file, kit, "components/ui/index.js");
  if (needs.has("toneVariant")) text = ensureImport(text, file, ["toneVariant"], "components/ui/badge.js");
  total += count;
  console.log(`${path.relative(root, file)}: ${badges.count} badges, ${selects.count} selects, ${chips.count} chips`);
  if (write) writeFileSync(file, text);
}
console.log(`${total} rewrites${write ? "" : " (dry run; pass --write)"}`);
