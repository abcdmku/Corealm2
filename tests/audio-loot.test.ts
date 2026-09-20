import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CorealmAudioBridge } from "../game/src/audio/gameAudio.js";
import { cueForLootedItem } from "../game/src/audio/director.js";
import { COREALM_AUDIO_CATALOG } from "../game/src/audio/corealmCatalog.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { content, type ContentTables } from "../game/src/content/index.js";
import type { AudioDirector } from "../game/src/audio/director.js";
import type { AudioEngine } from "../game/src/audio/engine.js";
import type { AudioCueId, GameEvent } from "../game/src/contracts.js";
import type { Store } from "../game/src/state/store.js";

/**
 * Gold is a loot drop like any other item, so the only thing that tells a purse from a pack is the
 * item's category. These pin that the split happens on the category and not on the id, and that a
 * burst of stacks cannot turn into a burst of sounds.
 */
const originalContent: ContentTables = {
  items: [...content.allItems()], resources: [...content.allResources()], recipes: [...content.allRecipes()],
  spells: [...content.allSpells()], enemies: [...content.allEnemies()], shops: [...content.allShops()],
};
beforeAll(() => { content.register({ items: ALL_ITEMS }); });
afterAll(() => { content.register(originalContent); });

function bridge() {
  const engine = { playCue: vi.fn(async (_cue: AudioCueId) => true), resetOneShots: vi.fn() };
  const state = {
    player: { id: "player", position: [0, 0, 0], facingRad: 0, health: 100, regionId: "fallowmarch", movement: { mode: "idle" } },
    equipment: {}, combat: { targetId: null, engagedBy: [] }, magic: { weaponCharges: {} }, activity: null,
  };
  const director = { observeActivity: vi.fn(), observeGameEvent: vi.fn(), observeCombatHit: vi.fn() };
  const audio = new CorealmAudioBridge({
    store: { get: () => state } as unknown as Store,
    engine: engine as unknown as AudioEngine,
    director: director as unknown as AudioDirector,
    entity: () => undefined,
    surfaceAt: () => "grass",
  });
  const received = (itemId: string, source = "loot"): GameEvent =>
    ({ type: "item.received", data: { itemId, quantity: 1, source }, atMs: 0 } as unknown as GameEvent);
  return { audio, engine, director, received, cues: () => engine.playCue.mock.calls.map(([cue]) => cue) };
}

describe("loot pickup audio", () => {
  it("rings for currency and knocks for everything else", () => {
    expect(cueForLootedItem(true)).toBe("interaction.loot_coins");
    expect(cueForLootedItem(false)).toBe("interaction.loot_item");
  });

  it("picks the cue from the item's category, so any currency item rings", () => {
    const currency = content.allItems().filter((item) => item.category === "currency");
    expect(currency.map((item) => item.id)).toEqual(["gold"]);
    const { audio, received, cues } = bridge();
    audio.handleEvent(received("gold"));
    audio.handleEvent(received("march_stone"));
    audio.handleEvent(received("worn_helm"));
    expect(cues()).toEqual(["interaction.loot_coins", "interaction.loot_item", "interaction.loot_item"]);
  });

  it("leaves gathering, buying and quest rewards to their own cues", () => {
    const { audio, received, cues, director } = bridge();
    audio.handleEvent(received("march_stone", "gather"));
    audio.handleEvent(received("gold", "quest"));
    audio.handleEvent(received("gold", "buy"));
    expect(cues()).toEqual([]);
    expect(director.observeActivity).not.toHaveBeenCalled();
  });

  it("collapses a whole pile taken at once into one knock and one ring", () => {
    // Taking everything emits one event per stack in the same tick. The gap each cue keeps is what
    // stops eight stacks sounding eight times; without it "take all" machine-guns.
    const item = COREALM_AUDIO_CATALOG.cues["interaction.loot_item"];
    const coins = COREALM_AUDIO_CATALOG.cues["interaction.loot_coins"];
    expect(item.minIntervalMs).toBeGreaterThanOrEqual(60);
    expect(coins.minIntervalMs).toBeGreaterThanOrEqual(60);
    expect(item.maxConcurrent).toBe(1);
    expect(coins.maxConcurrent).toBe(1);
  });

  it("gives opening a pile, pocketing gold and pocketing an item one fixed sound each", () => {
    // No rotation and no pitch jitter on any of the three: the same action sounds the same every
    // time, and the three never share a file.
    const files: string[] = [];
    for (const cue of ["interaction.loot", "interaction.loot_coins", "interaction.loot_item"] as const) {
      const definition = COREALM_AUDIO_CATALOG.cues[cue];
      expect(definition.variants).toHaveLength(1);
      expect(typeof definition.playbackRate).toBe("number");
      const variant = definition.variants[0]!;
      files.push(typeof variant === "string" ? variant : variant.url);
    }
    expect(new Set(files).size).toBe(3);
    expect(files[1]).toMatch(/loot-coins-01.ogg$/);
    expect(files[2]).toMatch(/loot-thump-01.ogg$/);
  });

  it("opens a pile with the same sound as opening a menu", () => {
    const click = COREALM_AUDIO_CATALOG.cues["ui.click"];
    const open = COREALM_AUDIO_CATALOG.cues["interaction.loot"];
    expect(open.variants).toEqual(click.variants);
    expect(open.gain).toBe(click.gain);
  });

  it("plays the knock below its recorded rate so it reads as dull", () => {
    expect(COREALM_AUDIO_CATALOG.cues["interaction.loot_item"].playbackRate).toBeLessThan(1);
  });
});
