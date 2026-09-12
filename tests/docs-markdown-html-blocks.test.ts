import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../tools/lib/paths.js";

/**
 * The guide mixes Markdown with hand-written HTML blocks for its card layouts.
 *
 * A Markdown HTML block runs until a blank line, so a `## Heading` on the line straight after a
 * closing tag is not a heading at all: it renders as the literal text "## Heading" and never
 * reaches the page outline. The generator is easy to get this wrong in, so the rule is checked
 * against the committed output rather than trusted.
 */
const guideRoot = path.resolve(repoRoot, "docs/game");
const blockClose = /<\/(?:div|figure|details)>\n(?<next>.+)/g;

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "assets" ? [] : markdownFiles(full);
    return full.endsWith(".md") ? [full] : [];
  });
}

describe("generated guide Markdown", () => {
  it("never opens Markdown content on the line after a closing HTML block", () => {
    const offenders: string[] = [];
    for (const file of markdownFiles(guideRoot)) {
      const body = readFileSync(file, "utf8");
      for (const match of body.matchAll(blockClose)) {
        const next = match.groups?.next ?? "";
        // Another raw tag on the next line is still the same HTML block, which is fine.
        if (next.startsWith("<")) continue;
        offenders.push(`${path.relative(repoRoot, file)}: ${next.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never nests one anchor inside another", () => {
    // The parser closes the outer anchor at the inner one, so a nested link does not stay nested:
    // it escapes its container and lands as a sibling, which wrecks any grid it was sitting in.
    const offenders: string[] = [];
    for (const file of markdownFiles(guideRoot)) {
      let depth = 0;
      for (const tag of readFileSync(file, "utf8").matchAll(/<(\/?)a[\s>]/g)) {
        depth += tag[1] === "/" ? -1 : 1;
        if (depth > 1) {
          offenders.push(`${path.relative(repoRoot, file)} at offset ${tag.index}`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
