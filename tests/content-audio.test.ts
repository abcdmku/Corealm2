import { describe, expect, it } from "vitest";
import audioData from "../game/content/data/audio/catalog.json";
import { AUDIO_CUE_IDS } from "../game/src/contracts.js";
import { CROWNWARD_MUSIC_AREAS } from "../game/src/audio/castleMusic.js";
import { COREALM_AUDIO_CATALOG, FUTURE_REGION_MUSIC_FILES } from "../game/src/audio/corealmCatalog.js";
import {
  audioCatalogSchema, audioCueSchema, audioUrlSchema, musicAreaSchema,
} from "../game/src/content/schema/audio.js";
import { parseValue, validateCollection } from "../game/src/content/schema/core.js";

describe("JSON audio content", () => {
  it("validates the stored catalogue and keeps every URL relative", () => {
    expect(parseValue(audioCatalogSchema, audioData, "audio")).toEqual(audioData);
    expect(Object.keys(audioData.cues)).toEqual([...AUDIO_CUE_IDS]);

    const urls: string[] = [];
    for (const cue of Object.values(audioData.cues)) {
      for (const variant of cue.variants) urls.push(typeof variant === "string" ? variant : variant.url);
    }
    for (const loop of Object.values(audioData.loops)) urls.push(loop.url);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => /^audio\/(?:sfx|music|ambience)\//.test(url))).toBe(true);
    expect(urls.every((url) => !url.startsWith("/"))).toBe(true);
  });

  it("keeps catalogue paths relative so the asset host can own them, and preserves authored order", () => {
    expect(Object.keys(COREALM_AUDIO_CATALOG.cues)).toEqual(Object.keys(audioData.cues));
    expect(Object.keys(COREALM_AUDIO_CATALOG.loops)).toEqual(Object.keys(audioData.loops));
    expect(Object.keys(COREALM_AUDIO_CATALOG.regions)).toEqual(Object.keys(audioData.regions));
    expect(COREALM_AUDIO_CATALOG.cues["movement.footstep_grass"].variants[0])
      .toBe("audio/sfx/nox/footstep-grass-01.ogg");
    expect(COREALM_AUDIO_CATALOG.loops["music.castle"]?.url).toBe("audio/music/castle.mp3");
    expect(audioData.regions.crownward?.musicAreas).toEqual(CROWNWARD_MUSIC_AREAS);
    expect(COREALM_AUDIO_CATALOG.regions.crownward?.musicAreas).toEqual(CROWNWARD_MUSIC_AREAS);
    expect(FUTURE_REGION_MUSIC_FILES).toEqual([
      "desert.mp3", "jungle.mp3", "goblin-village.mp3", "mire-swamp.mp3", "swamp.mp3",
    ]);
  });

  it("reports malformed audio fields at their content paths", () => {
    const bad = structuredClone(audioData) as {
      cues: Record<string, { variants: Array<string | { url: string }> }>;
      loops: Record<string, { url: string; bus: string }>;
      regions: Record<string, unknown>;
    };
    bad.cues["ui.click"]!.variants[0] = "/audio/sfx/filmcow-v1/ui-button-press-01.ogg";
    expect(() => parseValue(audioCatalogSchema, bad, "audio")).toThrow("audio.cues.ui.click.variants[0]");

    const invalidCue = { ...audioData.cues["ui.click"], variants: [] };
    expect(() => parseValue(audioCueSchema, invalidCue, "audio.cues.ui.click")).toThrow("variants");

    const invalidArea = { ...audioData.regions.crownward!.musicAreas![0], radius: 0 };
    expect(validateCollection(musicAreaSchema, [invalidArea], { name: "audio.regions.crownward.musicAreas" }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining("radius") })]));
    expect(() => parseValue(audioUrlSchema, "/audio/sfx/nope.ogg", "audio.url")).toThrow("audio.url");
  });

  it("exposes references and save identity metadata for the editor", () => {
    expect(audioUrlSchema.meta.ref).toBe("asset");
    expect(audioCatalogSchema.fields.cues.meta.label).toBe("Cues");
    expect(audioCatalogSchema.fields.regions.meta.label).toBe("Regions");
    expect(musicAreaSchema.fields.id.meta).toMatchObject({ readOnly: true, identity: true });
    expect(musicAreaSchema.fields.music.meta.ref).toBe("audio");
  });
});
