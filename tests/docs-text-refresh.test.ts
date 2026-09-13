import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("refreshes guide text without regenerating or replacing prebuilt media", () => {
  const out = mkdtempSync(path.join(os.tmpdir(), "docs-text-"));
  try {
    const icons = path.join(out, "assets/items");
    mkdirSync(icons, { recursive: true });
    const icon = path.join(icons, "prebuilt.webp");
    writeFileSync(icon, "prebuilt media sentinel");
    execFileSync(process.execPath, [
      "--import", "tsx", "tools/gen-docs.ts", "--out", out,
      "--provenance-out", path.join(out, "provenance.md"),
    ], { cwd: process.cwd(), stdio: "pipe" });
    expect(existsSync(path.join(out, "README.md"))).toBe(true);
    expect(readFileSync(icon, "utf8")).toBe("prebuilt media sentinel");
    expect(existsSync(path.join(icons, "thumb"))).toBe(false);
    expect(existsSync(path.join(out, "assets/world-map.webp"))).toBe(false);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
