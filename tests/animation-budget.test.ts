import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Logger, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { describe, expect, it } from "vitest";
import { analyzeAnimationUsage } from "../tools/analyze-animation-usage.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ASSET_ROOT = new URL("../game/public/assets/", import.meta.url);
const ANIMATION_LIBRARY_IDS = ["animation_library_1", "animation_library_2"] as const;
const MAX_RAW_ANIMATION_BYTES = 3_370_000;

interface AnimationManifestEntry {
  id: string;
  file: string;
  category: string;
  bytes: number;
  animations: string[];
}

interface AssetManifest {
  assets: AnimationManifestEntry[];
}

async function readAnimationManifestEntries(): Promise<AnimationManifestEntry[]> {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", ASSET_ROOT), "utf8")) as AssetManifest;
  return manifest.assets.filter((entry) => entry.category === "animation");
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

let reportPromise: ReturnType<typeof analyzeAnimationUsage> | undefined;

function readAnimationUsageReport(): ReturnType<typeof analyzeAnimationUsage> {
  reportPromise ??= analyzeAnimationUsage(REPO_ROOT);
  return reportPromise;
}

describe("runtime animation budget", () => {
  it("keeps shared clip requirements and mirror sources available in the built libraries", async () => {
    const report = await readAnimationUsageReport();
    expect(report.references.length, "no shared animation requirements were found").toBeGreaterThan(0);
    expect(report.missingClips, "shared clip references missing from the built libraries").toEqual([]);
    expect(report.manifestGlbMismatches, "stale manifest animation metadata").toEqual([]);

    const physicalClips = new Set(report.libraries.flatMap((library) => library.clips));
    for (const mirror of report.mirrors) {
      expect(physicalClips.has(mirror.sourceClip), `${mirror.clip} has no physical source clip`).toBe(true);
    }
    // Report sorting, classification unions, source line numbers and parser recipe coverage are
    // diagnostic details. Acceptance here is the availability of the referenced animation data.
  }, 30_000);

  it("keeps the analyzer, manifest, and two non-empty GLBs in exact agreement", async () => {
    const [report, manifestEntries] = await Promise.all([
      readAnimationUsageReport(),
      readAnimationManifestEntries(),
    ]);
    const entriesById = new Map(manifestEntries.map((entry) => [entry.id, entry]));

    expect(sorted(entriesById.keys())).toEqual(sorted(ANIMATION_LIBRARY_IDS));
    expect(sorted(report.libraries.map((library) => library.assetId))).toEqual(sorted(ANIMATION_LIBRARY_IDS));

    const io = new NodeIO()
      .registerExtensions(KHRONOS_EXTENSIONS)
      .setLogger(new Logger(Logger.Verbosity.ERROR));
    let combinedBytes = 0;

    for (const libraryId of ANIMATION_LIBRARY_IDS) {
      const entry = entriesById.get(libraryId);
      const library = report.libraries.find((candidate) => candidate.assetId === libraryId);
      expect(entry, `${libraryId} is absent from the asset manifest`).toBeDefined();
      expect(library, `${libraryId} is absent from the analyzer output`).toBeDefined();
      if (!entry || !library) continue;

      expect(library.file).toBe(entry.file);
      expect(library.bytes).toBe(entry.bytes);
      expect(library.clips).toEqual(entry.animations);
      expect(new Set(entry.animations).size, `${libraryId} contains duplicate clip names`).toBe(entry.animations.length);

      const bytes = await readFile(new URL(entry.file, ASSET_ROOT));
      combinedBytes += bytes.byteLength;
      expect(bytes.byteLength, `${entry.file} is empty`).toBeGreaterThan(12);
      expect(bytes.subarray(0, 4).toString("ascii"), `${entry.file} has no GLB header`).toBe("glTF");
      expect(bytes.readUInt32LE(4), `${entry.file} uses an unsupported GLB version`).toBe(2);
      expect(bytes.readUInt32LE(8), `${entry.file} has a corrupt declared length`).toBe(bytes.byteLength);
      expect(entry.bytes, `${entry.file} byte count drifted from the manifest`).toBe(bytes.byteLength);

      const document = await io.readBinary(new Uint8Array(bytes));
      const animations = document.getRoot().listAnimations();
      const glbClipNames = animations.map((animation) => animation.getName());
      expect(glbClipNames.length, `${entry.file} contains no animation clips`).toBeGreaterThan(0);
      expect(glbClipNames, `${entry.file} clip list drifted from the manifest`).toEqual(entry.animations);
      for (const animation of animations) {
        expect(animation.getName().trim(), `${entry.file} contains an unnamed clip`).not.toBe("");
        expect(
          animation.listChannels().length,
          `${entry.file} clip ${animation.getName()} has no animation channels`,
        ).toBeGreaterThan(0);
      }
    }

    expect(combinedBytes, "combined raw animation GLB payload").toBeLessThanOrEqual(MAX_RAW_ANIMATION_BYTES);
  }, 30_000);
});
