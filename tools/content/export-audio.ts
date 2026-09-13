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
const { COREALM_AUDIO_CATALOG } = await import(baseline) as {
  COREALM_AUDIO_CATALOG: LegacyCatalog;
};

function relativeUrl(url: string): string {
  if (!url.startsWith("/audio/")) throw new Error(`Expected a root audio URL, got ${url}`);
  return url.slice(1);
}

function relativeVariant(variant: LegacyVariant): LegacyVariant {
  return typeof variant === "string" ? relativeUrl(variant) : { ...variant, url: relativeUrl(variant.url) };
}

const relativeCatalog = {
  cues: Object.fromEntries(Object.entries(COREALM_AUDIO_CATALOG.cues).map(([id, cue]) => [id, {
    ...cue,
    variants: cue.variants.map(relativeVariant),
  }])),
  loops: Object.fromEntries(Object.entries(COREALM_AUDIO_CATALOG.loops).map(([id, loop]) => [id, {
    ...loop,
    url: relativeUrl(loop.url),
  }])),
  regions: Object.fromEntries(Object.entries(COREALM_AUDIO_CATALOG.regions).map(([id, region]) => [id, region])),
};

const canonical = parseValue(audioCatalogSchema, relativeCatalog, "audio");
await writeContentJson("data/audio/catalog.json", canonical);
console.log(`Exported ${Object.keys(canonical.cues).length} audio cues and ${Object.keys(canonical.loops).length} loops.`);
