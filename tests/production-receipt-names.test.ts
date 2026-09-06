import { describe, expect, it } from "vitest";
import { content } from "../game/src/content/index.js";
import { CREATURE_LOOT_ITEMS } from "../game/src/content/creatureLoot.js";
import { ELEMENTAL_MAGIC_WEAPONS } from "../game/src/content/equipment.js";
import { describeProductionCompletion } from "../game/src/ui/hud.js";

describe("production receipt display names", () => {
  it("uses ordinary catalogue names for monster-drop recipes and altar weapons", () => {
    content.register({items:[...CREATURE_LOOT_ITEMS,...ELEMENTAL_MAGIC_WEAPONS]});
    expect(describeProductionCompletion({itemId:"foxhair_ring",quantity:1})).toBe("Made 1 × Fox Fur Ring.");
    expect(describeProductionCompletion({itemId:"air_staff",quantity:1})).toBe("Made 1 × Air Staff.");
  });
  it("does not expose an underscored fallback when content is missing", () => {
    expect(describeProductionCompletion({itemId:"unregistered_test_item",quantity:2})).toBe("Made 2 × Unregistered Test Item.");
    expect(describeProductionCompletion({})).toBe("Production finished.");
  });
});
