import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_REPLACEMENTS, plainDisplayText } from "../game/src/content/displayNames.js";
import { ENEMY_BLOCKS } from "../game/src/content/enemies.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { REGIONS } from "../game/src/content/regions.js";
import { RECIPES } from "../game/src/content/recipes.js";

describe("familiar display names", () => {
  it("keeps production ore, tools and worked metal in the same material family", () => {
    for (const [id, metal] of [["grithe", "Copper"], ["corven", "Iron"], ["kaldite", "Cobalt"], ["emberite", "Titanium"]] as const) {
      for (const [suffix, label] of [["ore", "Ore"], ["bar", "Bar"], ["pickaxe", "Pickaxe"], ["sword", "Sword"]]) {
        const item = ALL_ITEMS.find((candidate) => candidate.id === `${id}_${suffix}`);
        expect(item, `${id}_${suffix} remains available under its saved ID`).toBeDefined();
        expect(item!.name).toBe(`${metal} ${label}`);
      }
    }
    expect(plainDisplayText("Nightmare-plated Kaldite Helm")).toBe("Pale Dragon Plated Cobalt Helm");
    expect(plainDisplayText("Talon-gripped Emberite Dagger")).toBe("Demon Claw Grip Titanium Dagger");
  });

  it("uses the specific creature or landmark before a material inside its old name", () => {
    expect(plainDisplayText("Duskoak Stag at the Duskoak Stand in Rootfall")).toBe("Stag at the Maple Grove in Oakwood");
    expect(plainDisplayText("Corven Ore near Corven Ford")).toBe("Iron Ore near River Crossing");
    expect(plainDisplayText("Ashfin at Ashfin Springs")).toBe("Bass at Hot Springs");
    expect(plainDisplayText("The Gravelmaw: Gravelmaw Cave Bear")).toBe("Stone Cavern: Cave Bear");
    expect(plainDisplayText("Kill Redsill Frogs, Bramble Hogs and Gravelmaw Rats.")).toBe("Kill Frogs, Pigs and Giant Rats.");
  });

  it("retains punctuation and ordinary prose casing without replacing parts of words", () => {
    expect(plainDisplayText("Grithe, GRITHE and grithe; Tempest Roc's nest.")).toBe("Copper, COPPER and copper; Storm Rhino's nest.");
    expect(plainDisplayText("coyotes, coneys and reavers")).toBe("wolves, rabbits and bandits");
    expect(plainDisplayText("Rococo, microcircuit, éGrithe, Grithe2, Grithewood")).toBe("Rococo, microcircuit, éGrithe, Grithe2, Grithewood");
    expect(plainDisplayText("(Grithe)—Corven")).toBe("(Copper)—Iron");
  });

  it("preserves identifiers embedded in guidance and all inline code spans", () => {
    const guidance = 'Kill Tempest Roc, entity tempest_roc. Keep grithe_ore and proc_rod_palewood. Use `moveTo({ entityId: "ordrun" })`, `kilnstone` and ``query(`Grithe`)``.';
    expect(plainDisplayText(guidance)).toBe('Kill Storm Rhino, entity tempest_roc. Keep grithe_ore and proc_rod_palewood. Use `moveTo({ entityId: "ordrun" })`, `kilnstone` and ``query(`Grithe`)``.');
    const fenced = "Grithe\n```ts\nconst target = 'Ordrun';\nconst wood = 'Palewood';\n```\nCorven";
    expect(plainDisplayText(fenced)).toBe("Copper\n```ts\nconst target = 'Ordrun';\nconst wood = 'Palewood';\n```\nIron");
  });

  it("keeps production enemy identities distinguishable after removing invented modifiers", () => {
    const names = ENEMY_BLOCKS.map((enemy) => enemy.name);
    expect(new Set(names).size).toBe(ENEMY_BLOCKS.length);
    const byId = new Map(ENEMY_BLOCKS.map((enemy) => [enemy.id, enemy.name]));
    expect(byId.get("coyote_t5")).toBe("Forest Wolf");
    expect(byId.get("coyote_t10")).toBe("Dire Wolf");
    expect(byId.get("tempest_roc_t1")).toBe("Storm Rhino");
    expect(byId.get("quarrykeeper_t10")).toBe("Armored Rhino");
    expect(byId.get("cinder_ravager_t20")).toBe("Armored Demon");
    expect(byId.get("gorge_mantis_t20")).toBe("Giant Mantis");
  });

  it("makes creature trophies agree with the model names while preserving drop IDs", () => {
    const trophies = new Map(ALL_ITEMS.map((item) => [item.id, item.name]));
    expect(trophies.get("coyote_fang")).toBe("Wolf Fang");
    expect(trophies.get("ashback_claw")).toBe("Dire Bear Claw");
    expect(trophies.get("ravager_talon")).toBe("Demon Claw");
    expect(trophies.get("drake_scale")).toBe("Armored Dragon Scale");
    expect(trophies.get("nightmare_plate")).toBe("Pale Dragon Plate");
  });

  it("keeps regions and their towns distinct", () => {
    expect(REGIONS.map((region) => [region.id, region.name])).toEqual([
      ["fallowmarch", "Farmland"], ["vellenwood", "Woodlands"],
      ["karrowmoor", "Highlands"], ["kilnhalt", "Ashlands"],
    ]);
    expect(plainDisplayText("Coldbrace / Rootfall / Highcairn / Emberfast")).toBe("Millfield / Oakwood / Hillcrest / Ashford");
    expect(REGIONS.map((region) => region.settlement.name)).toEqual(["Millfield", "Oakwood", "Hillcrest", "Ashford"]);
  });

  it("uses canonical item names for recipes instead of title-casing saved IDs", () => {
    const items = new Map(ALL_ITEMS.map((item) => [item.id, item.name]));
    for (const id of ["fletch_palewood_rod", "fletch_duskoak_rod", "fletch_cairnpine_rod", "fletch_cinderpine_rod", "craft_charhide_robe", "craft_cairnpelt_robe", "cook_seared_cragfin", "cook_seared_ashfin"]) {
      const recipe = RECIPES.find((candidate) => candidate.id === id);
      expect(recipe, id).toBeDefined();
      expect(recipe!.name).toBe(items.get(recipe!.output.itemId));
    }
  });

  it("does not rename already formatted production copy on subsequent reads", () => {
    const copy = [
      ...Object.values(DISPLAY_NAME_REPLACEMENTS),
      ...ALL_ITEMS.flatMap((item) => [item.name, item.description]),
      ...ENEMY_BLOCKS.map((enemy) => enemy.name),
      ...REGIONS.flatMap((region) => [region.name, ...region.locations.map((location) => location.name)]),
    ];
    for (const original of copy) {
      const formatted = plainDisplayText(original);
      expect(plainDisplayText(formatted), original).toBe(formatted);
    }
  });
});
