/**
 * One individual's look, rolled from its definition's variation range.
 *
 * The world layer calls `rollCreatureLook` when it builds a creature entity and writes the result
 * into `entity.view` (`scale`, `skinId`, `colour`); the renderer only draws what it is given.
 * Devdocs calls the same function to preview a crowd, so the preview is the game's roll.
 * Pure and deterministic: the same entity id always rolls the same look.
 */
import { Rng } from "../core/rng.js";

export interface CreatureVariation {
  readonly scale?: readonly [number, number];
  readonly hue?: number;
  readonly saturation?: readonly [number, number];
  readonly value?: readonly [number, number];
  readonly skins?: readonly { readonly skinId: string; readonly weight: number }[];
  readonly baseWeight?: number;
}

export interface CreatureLookInput {
  /** The definition's scale. */
  readonly scale: number;
  /** The definition's own look, if it wears a skin. */
  readonly skinId?: string;
  readonly variation?: CreatureVariation;
}

export interface CreatureLookColour { hue: number; saturation: number; value: number }

export interface RolledCreatureLook {
  scale: number;
  skinId?: string;
  colour?: CreatureLookColour;
}

/** FNV-1a over the seed text; stable across platforms and releases. */
function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function rollCreatureLook(input: CreatureLookInput, entityId: string): RolledCreatureLook {
  const variation = input.variation;
  if (!variation) return { scale: input.scale, ...(input.skinId ? { skinId: input.skinId } : {}) };
  // One stream per aspect, so adding a skin to the pool never moves anyone's size or colour.
  const roll = (aspect: string) => new Rng(seedOf(`${aspect}:${entityId}`)).next();
  const between = ([min, max]: readonly [number, number], aspect: string) => min + (max - min) * roll(aspect);

  const scale = input.scale * (variation.scale ? between(variation.scale, "scale") : 1);

  let skinId = input.skinId;
  const pool = variation.skins ?? [];
  if (pool.length) {
    const own = Math.max(0, variation.baseWeight ?? 1);
    const total = own + pool.reduce((sum, entry) => sum + entry.weight, 0);
    let pick = roll("skin") * total - own;
    if (pick >= 0) {
      skinId = pool[pool.length - 1]!.skinId;
      for (const entry of pool) { if (pick < entry.weight) { skinId = entry.skinId; break; } pick -= entry.weight; }
    }
  }

  const hue = variation.hue ? (roll("hue") * 2 - 1) * variation.hue : 0;
  const saturation = variation.saturation ? between(variation.saturation, "saturation") : 1;
  const value = variation.value ? between(variation.value, "value") : 1;
  const colour = hue !== 0 || saturation !== 1 || value !== 1 ? { hue, saturation, value } : undefined;

  return { scale, ...(skinId ? { skinId } : {}), ...(colour ? { colour } : {}) };
}
