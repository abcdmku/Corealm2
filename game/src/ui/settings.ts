/**
 * Player-facing settings, and the only place they are stored.
 *
 * Deliberately small and deliberately real: every setting here changes the client immediately,
 * and the root subscribes to apply it. A setting that does nothing is worse than no settings
 * screen, because it teaches the player that the screen is decoration.
 *
 * Persisted separately from the save. These are preferences about the client, not about the
 * character, so "New Game" must not reset them and a save transferred between browsers must not
 * carry them.
 *
 * The root subscribes once and wires each value. Render scale changes the WebGL drawing buffer,
 * shadow quality changes both the shadow-map size and whether the sun casts one, inversion lands
 * on the camera, damage numbers are never created rather than created-and-hidden, and compact
 * density puts `.is-compact` on `#ui-root`. The same update carries the three audio bus gains.
 */

import type { AudioVolumes } from "../contracts.js";

export type RenderScale = 0.7 | 0.85 | 1;
export type ShadowQuality = "off" | "low" | "high";
export type DrawDistance = "near" | "medium" | "far";

export interface UiSettings extends AudioVolumes {
  /** Fraction of the native drawing-buffer resolution. */
  renderScale: RenderScale;
  /** Off, a 1024 px map, or a 2048 px map. */
  shadowQuality: ShadowQuality;
  /** Camera and fog range preset. */
  drawDistance: DrawDistance;
  /** Adapt view distance to sustained frame performance; other graphics settings stay manual. */
  autoDrawDistance: boolean;
  /** Floating damage numbers over combat. */
  damageNumbers: boolean;
  /** Invert the vertical axis while orbiting the camera. */
  invertCameraY: boolean;
  /** Panel and HUD density. */
  uiScale: "compact" | "normal";
}

export const DEFAULT_SETTINGS: UiSettings = {
  music: 0.6,
  ambient: 0.7,
  sfx: 0.8,
  renderScale: 1,
  shadowQuality: "high",
  drawDistance: "far",
  autoDrawDistance: true,
  damageNumbers: true,
  invertCameraY: true,
  uiScale: "normal",
};

const STORAGE_KEY = "corealm.settings.v1";

type Listener = (settings: UiSettings) => void;

/**
 * The live settings, with change notification.
 *
 * One instance, created by `createUi` and handed to the root so it can wire the effects. Reading is
 * synchronous; writing notifies every listener and persists.
 */
export class SettingsStore {
  private settings: UiSettings = { ...DEFAULT_SETTINGS };
  private readonly listeners = new Set<Listener>();

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...readStored() };
  }

  get(): UiSettings {
    return { ...this.settings };
  }

  /** Applies a partial change, persists it, and notifies. */
  set(patch: Partial<UiSettings>): UiSettings {
    const normalised = normaliseAudioPatch(patch);
    const changed = (Object.keys(normalised) as (keyof UiSettings)[])
      .some((key) => !Object.is(this.settings[key], normalised[key]));
    if (!changed) return this.get();

    this.settings = { ...this.settings, ...normalised };
    writeStored(this.settings);
    for (const listener of this.listeners) listener(this.get());
    return this.get();
  }

  reset(): UiSettings {
    return this.set({ ...DEFAULT_SETTINGS });
  }

  /** Fires immediately with the current value, then on every change. Returns an unsubscribe. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.get());
    return () => { this.listeners.delete(listener); };
  }
}

/**
 * Reads what is in storage, field by field.
 *
 * The stored blob is JSON, so it is `unknown` no matter what the type says: an older build, a
 * hand-edited value or a half-written string all end up here. Anything that is not the right shape
 * is dropped and the default stands, because a `uiScale` of `"huge"` would otherwise be spread
 * straight into the store and every reader would trust it.
 */
function readStored(): Partial<UiSettings> {
  let parsed: unknown;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt or unavailable store falls back to defaults. Preferences are never worth a crash.
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const source = parsed as Record<string, unknown>;
  const out: Partial<UiSettings> = {};
  if (isVolume(source["music"])) out.music = source["music"];
  if (isVolume(source["ambient"])) out.ambient = source["ambient"];
  if (isVolume(source["sfx"])) out.sfx = source["sfx"];
  if (source["renderScale"] === 0.7 || source["renderScale"] === 0.85 || source["renderScale"] === 1) {
    out.renderScale = source["renderScale"];
  }
  if (source["shadowQuality"] === "off" || source["shadowQuality"] === "low" || source["shadowQuality"] === "high") {
    out.shadowQuality = source["shadowQuality"];
  } else if (source["shadows"] === false) {
    // Migration from the original on/off setting. An old "on" value keeps the new high default.
    out.shadowQuality = "off";
  }
  if (source["drawDistance"] === "near" || source["drawDistance"] === "medium" || source["drawDistance"] === "far") {
    out.drawDistance = source["drawDistance"];
    // Existing explicit preferences remain manual until the player selects Auto.
    out.autoDrawDistance = false;
  }
  if (typeof source["autoDrawDistance"] === "boolean") out.autoDrawDistance = source["autoDrawDistance"];
  if (typeof source["damageNumbers"] === "boolean") out.damageNumbers = source["damageNumbers"];
  if (typeof source["invertCameraY"] === "boolean") out.invertCameraY = source["invertCameraY"];
  if (source["uiScale"] === "compact" || source["uiScale"] === "normal") out.uiScale = source["uiScale"];
  return out;
}

/** Keeps programmatic callers on the same inclusive range as the sliders and audio contract. */
function normaliseAudioPatch(patch: Partial<UiSettings>): Partial<UiSettings> {
  const normalised = { ...patch };
  if (typeof normalised.music === "number") normalised.music = clampVolume(normalised.music);
  if (typeof normalised.ambient === "number") normalised.ambient = clampVolume(normalised.ambient);
  if (typeof normalised.sfx === "number") normalised.sfx = clampVolume(normalised.sfx);
  return normalised;
}

function isVolume(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function writeStored(settings: UiSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing, quota, or no storage at all. The session still honours the setting.
  }
}
