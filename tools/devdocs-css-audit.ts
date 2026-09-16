import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/*
  How much hand-written CSS the Codex still has, and which of it is dead.

    npx tsx tools/devdocs-css-audit.ts [--dead]

  For every stylesheet under devdocs/src: its rule count and the class names its selectors use, and
  for each class whether any .ts/.tsx file still mentions it. `--dead` lists only unused classes.
  The editor is styled with Tailwind utilities on components; this is the worklist for removing the
  rest, and tests/devdocs-ui-consistency.test.ts holds the line once it reaches the floor.
*/

const root = path.resolve("devdocs/src");
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const files = walk(root);
const sources = files.filter(file => /\.(tsx?|jsx?)$/.test(file)).map(file => readFileSync(file, "utf8")).join("\n");
const stylesheets = files.filter(file => file.endsWith(".css"));
const deadOnly = process.argv.includes("--dead");

let totalLines = 0;
for (const sheet of stylesheets) {
  const text = readFileSync(sheet, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const lines = text.split("\n").filter(line => line.trim() && !/^[{}]$/.test(line.trim()) && !line.startsWith("@layer")).length;
  totalLines += lines;
  const classes = [...new Set([...text.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match => match[1]!))].filter(name => !/^\d/.test(name));
  const dead = classes.filter(name => !new RegExp(`(["'\`\\s.]|^)${name.replace(/-/g, "\\-")}(["'\`\\s:)\\]]|$)`, "m").test(sources));
  if (deadOnly && !dead.length) continue;
  console.log(`${path.relative(root, sheet)}: ${lines} lines, ${classes.length} classes, ${dead.length} unused${dead.length ? `\n  ${dead.join(" ")}` : ""}`);
}
console.log(`total: ${totalLines} lines of hand-written CSS in ${stylesheets.length} files`);
