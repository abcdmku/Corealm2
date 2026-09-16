import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
  The devdocs UI is Tailwind on the components in devdocs/src/components/ui. These checks keep it
  that way: no stylesheet beyond the theme tokens, no retired global class names (their CSS is gone,
  so a stray one renders unstyled), and no page drawing its own select, textarea or input.
*/

const SRC = path.resolve("devdocs/src");

function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : files(full, test);
    return test(entry.name) ? [full] : [];
  });
}

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");
const tsx = files(SRC, name => name.endsWith(".tsx"));

/** Every quoted string that is, or starts, a className. */
function classTokens(source: string): string[] {
  const tokens: string[] = [];
  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([^)]*)\)\})/g)) {
    const text = match[1] ?? match[2] ?? match[3] ?? "";
    for (const literal of match[3] !== undefined ? [...text.matchAll(/"([^"]*)"/g)].map(inner => inner[1]!) : [text]) tokens.push(...literal.split(/\s+/).filter(Boolean));
  }
  return tokens;
}

// Retired global classes: each was a rule in a deleted stylesheet.
const RETIRED = [
  /^matrix$/, /^cell(-num|-empty|-number)?$/, /^drawer(-head|-body|-scrim)?$/, /^ref-row-(body|title|sub|meta|tag)$/, /^ref-rows?$/, /^ref-list$/,
  /^tile-(grid|art|body|title|subtitle|badges|corner|check|row)$/, /^bestiary-(toolbar|count|group|list)$/, /^panel(-header|-body|-header-actions)?$/,
  /^page(-heading|-heading-actions)?$/, /^section-heading$/, /^segmented$/, /^button$/, /^badge$/, /^muted$/, /^mono$/, /^count-badge$/,
  /^empty-inline$/, /^stat(-grid)?$/, /^chip-row$/, /^field-(unit|hint|has-list)$/, /^curve-table$/, /^consequences$/, /^unmoved$/,
  /^home-(workspaces|workspace|columns|block)$/, /^entity-summary$/, /^model-stage$/, /^drop-(grid|tile|tile-name|tile-meta)$/, /^field-tuple$/, /^entity-editor$/,
];

describe("devdocs UI consistency", () => {
  it("has no stylesheet besides the theme", () => {
    expect(files(SRC, name => name.endsWith(".css")).map(rel)).toEqual(["styles/theme.css"]);
  });

  it("keeps the theme to tokens and base rules", () => {
    const theme = readFileSync(path.join(SRC, "styles/theme.css"), "utf8");
    expect(theme).not.toMatch(/@layer components\s*\{/);
  });

  it("uses no retired global class names", () => {
    const offenders = tsx.flatMap(file => classTokens(readFileSync(file, "utf8")).filter(token => RETIRED.some(pattern => pattern.test(token))).map(token => `${rel(file)}: ${token}`));
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("draws selects, textareas and text inputs only through components/ui", () => {
    // The 3D viewer's scrubber is a native range input; a range has no kit component.
    const offenders = tsx.filter(file => !rel(file).startsWith("components/ui/")).flatMap(file => {
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      return [...source.matchAll(/<(select|textarea|input)\b[^>]*>/g)].filter(match => !/type="(range|file|hidden)"/.test(match[0])).map(match => `${rel(file)}: <${match[1]}>`);
    });
    expect(offenders).toEqual([]);
  });
});
