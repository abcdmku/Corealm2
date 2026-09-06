import type { AudioCueId, AudioBus, RegionId } from "../contracts.js";

/** One file variant for a semantic one-shot cue. */
export interface AudioVariant {
  url: string;
  /** Multiplier applied before the SFX bus gain. Defaults to 1. */
  gain?: number;
  /**
   * Seconds of the recording to skip so its transient lands on the frame that asked for it.
   *
   * Several contact recordings carry 50-140 ms of room tone before the hit. Played from zero on a
   * rig contact marker, the thud arrives that much after the frame. Measured by
   * `runs/corealm-rebuild/checks/audio-file-review.ts` (first millisecond within 30 dB of the peak,
   * minus a 5 ms guard); the source files stay byte-identical to their ledgers.
   */
  startOffsetS?: number;
}

export interface AudioCueDefinition {
  variants: readonly (string | AudioVariant)[];
  /** Multiplier applied before the SFX bus gain. Defaults to 1. */
  gain?: number;
  /** Per-cue voice limit, including files still being decoded. Defaults to 4. */
  maxConcurrent?: number;
  /** Minimum wall-clock gap between accepted plays. Defaults to 40 ms. */
  minIntervalMs?: number;
  /** Fixed rate or a range whose midpoint is used deterministically. Defaults to 1. */
  playbackRate?: number | readonly [number, number];
}

export interface AudioLoopDefinition {
  url: string;
  bus: AudioBus;
  /** Multiplier applied before the selected bus gain. Defaults to 1. */
  gain?: number;
  /** Default fade used by loop start and stop calls. Defaults to 800 ms. */
  fadeMs?: number;
  /** Optional loop points in seconds. Both are passed directly to Web Audio. */
  loopStart?: number;
  loopEnd?: number;
}

export interface RegionAudioDefinition {
  /** Loop key or a rotating pool of loop keys. Omit when a region has no matching track. */
  music?: string | readonly string[];
  /** Loop key or a rotating pool of loop keys. */
  ambient?: string | readonly string[];
}

/**
 * The runtime owns playback policy, not file choices. Root supplies this catalog after asset
 * curation, so this module never guesses a filename or silently promotes a future-region track.
 */
export interface AudioCatalog {
  cues?: Partial<Record<AudioCueId, AudioCueDefinition>>;
  loops?: Readonly<Record<string, AudioLoopDefinition>>;
  regions?: Partial<Record<RegionId, RegionAudioDefinition>>;
}

/** Keeps catalog literals narrow while checking their shape. */
export function defineAudioCatalog<const T extends AudioCatalog>(catalog: T): T {
  return catalog;
}
