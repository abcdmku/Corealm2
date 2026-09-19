import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
  A skill row is a <button>, so everything inside it has to be a <span> — a button takes phrasing
  content, not divs. A span is inline, and height does nothing to an inline box, so every skill
  progress bar painted as a hairline with no fill while its inline width said 76.6%.

  The fill's own CSS is what makes it a box. This suite has no jsdom by design, so the paint itself
  is proved by the smoke gate; here we keep the declaration that lets a span fill paint at all, and
  keep the elements panels build honest about it.
*/

const UI = path.resolve("game/src/ui");

function cssFiles(): string[] {
  const styles = path.join(UI, "styles");
  return [
    path.join(UI, "styles.css"),
    ...readdirSync(styles).filter(name => name.endsWith(".css")).map(name => path.join(styles, name)),
  ];
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/** Declarations for `.name`, merged across every rule that selects the class on its own. */
function declarationsFor(className: string): string {
  let merged = "";
  for (const file of cssFiles()) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (selectors!.split(",").some(selector => selector.trim() === `.${className}`)) merged += `;${body!}`;
    }
  }
  return merged;
}

/** Tags the panels create and then label with `className`. */
function tagsFor(className: string): Set<string> {
  const tags = new Set<string>();
  for (const file of tsFiles(UI)) {
    const created = new Map<string, string>();
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const make = line.match(/(?:const|let)\s+(\w+)\s*=\s*document\.createElement\("(\w+)"\)/);
      if (make) created.set(make[1]!, make[2]!);
      const assign = line.match(/(\w+)\.className\s*=\s*"([^"]*)"/);
      const tag = assign && created.get(assign[1]!);
      if (tag && assign[2]!.split(/\s+/).includes(className)) tags.add(tag);
    }
  }
  return tags;
}

describe("progress bar fill", () => {
  it("is a block, so the span fills inside skill rows still paint", () => {
    const body = declarationsFor("bar__fill");
    expect(body).toMatch(/display\s*:\s*block/);
    expect(body).toMatch(/height\s*:\s*100%/);
  });

  it("is still built as a span somewhere, which is why the display matters", () => {
    expect([...tagsFor("bar__fill")]).toContain("span");
  });
});
