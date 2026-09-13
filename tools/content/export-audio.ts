/** One-shot M1 export from the pre-migration TypeScript snapshot. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../lib/paths.js";
import { parseValue } from "../../game/src/content/schema/core.js";
import { audioCatalogSchema } from "../../game/src/content/schema/audio.js";
import { writeContentJson } from "./format.js";

type LegacyVariant = string | { url: string; gain?: number; startOffsetS?: number };
type LegacyCue = {
  variants: readonly LegacyVariant[];
  gain?: number;
  maxConcurrent?: number;
  minIntervalMs?: number;
  playbackRate?: number | readonly [number, number];
};
type LegacyLoop = {
  url: string;
  bus: string;
  gain?: number;
  fadeMs?: number;
  loopStart?: number;
  loopEnd?: number;
};
type LegacyRegion = {
  music?: string | readonly string[];
  ambient?: string | readonly string[];
  musicAreas?: readonly {
    id: string;
    music: string;
    centre: readonly [number, number];
    radius: number;
    exitPadding?: number;
  }[];
};
type LegacyCatalog = {
  cues: Record<string, LegacyCue>;
  loops: Record<string, LegacyLoop>;
  regions: Record<string, LegacyRegion>;
};

const baseline = pathToFileURL(path.join(repoRoot, ".baseline/game/src/audio/corealmCatalog.ts")).href;

function applyRequested(args: readonly string[]): boolean {
  const unexpected = args.filter((arg) => arg !== "--apply");
  if (unexpected.length > 0) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  if (args.filter((arg) => arg === "--apply").length > 1) throw new Error("Duplicate --apply argument");
  return args.includes("--apply");
}

function relativeUrl(url: string): string {
  if (!url.startsWith("/audio/")) throw new Error(`Expected a root audio URL, got ${url}`);
  return url.slice(1);
}

function relativeVariant(variant: LegacyVariant): LegacyVariant {
  return typeof variant === "string" ? relativeUrl(variant) : { ...variant, url: relativeUrl(variant.url) };
}

function relativeCatalog(source: LegacyCatalog) {
  return {
    cues: Object.fromEntries(Object.entries(source.cues).map(([id, cue]) => [id, {
      ...cue,
      variants: cue.variants.map(relativeVariant),
    }])),
    loops: Object.fromEntries(Object.entries(source.loops).map(([id, loop]) => [id, {
      ...loop,
      url: relativeUrl(loop.url),
    }])),
    regions: Object.fromEntries(Object.entries(source.regions).map(([id, region]) => [id, region])),
  };
}

export async function buildAudioExport() {
  const module = await import(baseline) as { COREALM_AUDIO_CATALOG: LegacyCatalog };
  if (!module.COREALM_AUDIO_CATALOG || typeof module.COREALM_AUDIO_CATALOG !== "object") {
    throw new Error("Baseline audio module does not export COREALM_AUDIO_CATALOG");
  }
  return parseValue(audioCatalogSchema, relativeCatalog(module.COREALM_AUDIO_CATALOG), "audio");
}

export async function runAudioExport(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const apply = applyRequested(args);
  const canonical = await buildAudioExport();
  console.log(`Validated ${Object.keys(canonical.cues).length} audio cues and ${Object.keys(canonical.loops).length} loops from .baseline.`);
  if (!apply) {
    console.log("Dry run: no files written. Pass --apply to replace data/audio/catalog.json.");
    return;
  }
  const changed = await writeContentJson("data/audio/catalog.json", canonical);
  console.log(changed ? "Applied audio export." : "Audio catalog already matches.");
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  await runAudioExport();
}
