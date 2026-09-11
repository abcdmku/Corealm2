import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { generatedItemIconMaster, readItemIconArtRegistry, type ItemIconArtEntry } from "../tools/lib/item-icon-art.js";

describe("generated icon provenance", () => {
  it("rejects changed source bytes and opaque backgrounds without silently substituting artwork", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "item-icon-art-"));
    try {
      const source = await sharp({ create: { width: 64, height: 64, channels: 4, background: "red" } }).png().toBuffer();
      await writeFile(path.join(dir, "source.png"), source);
      const entry: ItemIconArtEntry = { status: "pending", source: "source.png", sha256: "0".repeat(64), prompt: "test", generator: "built-in image_gen", sourceLookup: "test fixture", review: "pending root review" };
      await expect(generatedItemIconMaster(entry, 256, dir)).rejects.toThrow("hash mismatch");
      await expect(generatedItemIconMaster({ ...entry, sha256: createHash("sha256").update(source).digest("hex") }, 256, dir)).rejects.toThrow("real transparency");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("rejects source traversal and missing review status", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "item-icon-art-"));
    try {
      const entry = { status: "pending", source: "../source.png", sha256: "0".repeat(64), prompt: "test", generator: "built-in image_gen", sourceLookup: "test fixture", review: "pending root review" };
      await writeFile(path.join(dir, "registry.json"), JSON.stringify({ version: 1, items: { test: entry } }));
      await expect(readItemIconArtRegistry(dir)).rejects.toThrow("escapes");
      await writeFile(path.join(dir, "registry.json"), JSON.stringify({ version: 1, items: { test: { ...entry, source: "source.png", status: undefined } } }));
      await expect(readItemIconArtRegistry(dir)).rejects.toThrow("provenance");
      await writeFile(path.join(dir, "registry.json"), '\uFEFF' + JSON.stringify({ version: 1, items: { test: { ...entry, source: "source.png" } } }));
      expect((await readItemIconArtRegistry(dir)).test?.status).toBe("pending");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
