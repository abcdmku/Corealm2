import type { AudioCueDefinition, AudioLoopDefinition, AudioVariant, RegionAudioDefinition } from "./catalog.js";
import audioData from "../../content/data/audio/catalog.json";
import { parseValue } from "../content/schema/core.js";
import { audioCatalogSchema } from "../content/schema/audio.js";
import { defineAudioCatalog } from "./catalog.js";

const publicBase = import.meta.env?.BASE_URL ?? "/";
const publicAsset = (pathname: string): string => `${publicBase.replace(/\/?$/, "/")}${pathname.replace(/^\/+/, "")}`;

type StoredVariant = string | { url: string; gain?: number; startOffsetS?: number };
type PublicVariant<T> = T extends string ? string : T extends { url: string } ? AudioVariant : never;
type PublicCue<T extends { variants: readonly StoredVariant[] }> = Omit<AudioCueDefinition, "variants"> & {
  variants: PublicVariant<T["variants"][number]>[];
};

const parsedAudioData = parseValue(audioCatalogSchema, audioData, "audio") as unknown as typeof audioData;

function mapVariant(variant: StoredVariant): string | AudioVariant {
  return typeof variant === "string" ? publicAsset(variant) : { ...variant, url: publicAsset(variant.url) };
}

function mapCues<const T extends Record<string, { variants: readonly StoredVariant[] }>>(
  table: T,
): { [K in keyof T]: PublicCue<T[K]> } {
  return Object.fromEntries(Object.entries(table).map(([id, cue]) => [id, {
    ...cue,
    variants: cue.variants.map(mapVariant),
  }])) as unknown as { [K in keyof T]: PublicCue<T[K]> };
}

function mapLoops<const T extends Record<string, { url: string }>>(
  table: T,
): { [K in keyof T]: AudioLoopDefinition } {
  return Object.fromEntries(Object.entries(table).map(([id, loop]) => [id, {
    ...loop,
    url: publicAsset(loop.url),
  }])) as { [K in keyof T]: AudioLoopDefinition };
}

function asRegions<const T extends Record<string, unknown>>(table: T): { [K in keyof T]: RegionAudioDefinition } {
  return table as unknown as { [K in keyof T]: RegionAudioDefinition };
}

const cues = mapCues(parsedAudioData.cues);
const loops = mapLoops(parsedAudioData.loops);
const regions = asRegions(parsedAudioData.regions);

/** Runtime catalogue: JSON supplies choices, while this loader resolves the deployed public base. */
export const COREALM_AUDIO_CATALOG = defineAudioCatalog({ cues, loops, regions });

export const FUTURE_REGION_MUSIC_FILES = [
  "desert.mp3", "jungle.mp3", "goblin-village.mp3", "mire-swamp.mp3", "swamp.mp3",
] as const;
