import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/*
  One-off codemod: every `<button className="button …">`, `"icon-button …"` and `"text-button …"`
  with a plain string className becomes the shared `<Button>` with the matching variant and size.
  Classes the legacy names do not cover (`editor-save`, `ref-edit`) are kept on `className` so their
  pages can move them to Tailwind. Template-literal classNames are reported, not rewritten.

    npx tsx tools/devdocs-codemod-buttons.ts [--write]
*/

const root = path.resolve("devdocs/src");
const write = process.argv.includes("--write");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
});

const LEGACY = new Set(["button", "button-small", "button-primary", "button-danger", "button-ghost", "icon-button", "text-button", "is-active"]);

function props(classes: string[]): string | undefined {
  const has = (name: string) => classes.includes(name);
  let variant: string, size: string;
  if (has("icon-button")) { variant = "ghost"; size = "icon-sm"; }
  else if (has("text-button")) { variant = "link"; size = "inline"; }
  else if (has("button")) {
    variant = has("button-primary") ? "default" : has("button-danger") ? "destructive" : has("button-ghost") ? "ghost" : "secondary";
    size = "sm";
  } else return undefined;
  const pressed = has("is-active") ? ' aria-pressed="true"' : "";
  const rest = classes.filter(name => !LEGACY.has(name));
  return `variant="${variant}" size="${size}"${pressed}${rest.length ? ` className="${rest.join(" ")}"` : ""}`;
}

let changedFiles = 0, rewrites = 0;
const skipped: string[] = [];
for (const file of walk(root)) {
  if (file.includes(`${path.sep}components${path.sep}ui${path.sep}`)) continue;
  const source = readFileSync(file, "utf8");
  let count = 0;
  let out = "";
  let cursor = 0;
  const open = /<button\b([^>]*?)\sclassName="([^"]*)"([^>]*?)(\/?)>/g;
  for (let match = open.exec(source); match; match = open.exec(source)) {
    const classes = match[2]!.split(/\s+/).filter(Boolean);
    const mapped = props(classes);
    if (!mapped) continue;
    const close = source.indexOf("</button>", open.lastIndex);
    if (match[4] !== "/" && close < 0) continue;
    const attributes = `${match[1]}${match[3]}`.replace(/\stype="button"/, "");
    out += source.slice(cursor, match.index) + `<Button ${mapped}${attributes}${match[4] === "/" ? " />" : ">"}`;
    if (match[4] === "/") { cursor = open.lastIndex; }
    else {
      out += source.slice(open.lastIndex, close) + "</Button>";
      cursor = close + "</button>".length;
      open.lastIndex = cursor;
    }
    count++;
  }
  out += source.slice(cursor);
  for (const match of source.matchAll(/className=\{`[^`]*\b(button|icon-button|text-button)\b/g)) skipped.push(`${path.relative(root, file)}: ${match[0].slice(0, 80)}`);
  if (!count) continue;
  if (!/import \{[^}]*\bButton\b[^}]*\} from "[^"]*components\/ui\/index\.js";/.test(out)) {
    const relative = path.relative(path.dirname(file), path.join(root, "components/ui/index.js")).split(path.sep).join("/");
    const specifier = relative.startsWith(".") ? relative : `./${relative}`;
    const lastImport = [...out.matchAll(/^import [^;]+;$/gm)].at(-1);
    const at = lastImport ? lastImport.index! + lastImport[0].length : 0;
    out = `${out.slice(0, at)}\nimport { Button } from "${specifier}";${out.slice(at)}`;
  }
  changedFiles++; rewrites += count;
  if (write) writeFileSync(file, out);
  console.log(`${path.relative(root, file)}: ${count}`);
}
console.log(`${rewrites} buttons in ${changedFiles} files${write ? " rewritten" : " (dry run; pass --write)"}`);
if (skipped.length) console.log(`template-literal classNames to do by hand:\n- ${skipped.join("\n- ")}`);
