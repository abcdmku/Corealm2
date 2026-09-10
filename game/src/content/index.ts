/**
 * The canonical content registry.
 *
 * This is the seam that lets systems be built against content that does not exist yet: a worker
 * imports `content` and codes against these accessors, while another worker authors the tables
 * behind them. Round 1 lost time to two workers inventing the same coordinate frame; freezing the
 * accessor up front is the fix.
 *
 * Every table is registered once at boot and never mutated afterwards. An unknown id returns
 * `undefined` rather than throwing, so a content gap degrades to a `NOT_FOUND` Result at the API
 * boundary instead of crashing a frame.
 *
 * FROZEN. Only the root edits this file.
 */
import { CREATURE_PURSUIT_CEILING_MPS } from "./creatureMotionTiming.js";
import { tierSilhouetteScale } from "../core/math.js";
import type {
  EquipSlot, ItemDef, ItemId, RecipeId, SkillId, SpellElement, SpellId, SpellRung, StationKind,
} from "../contracts.js";

// ---------------------------------------------------------------- resources

export type GatheringResourceArchetype = "ore" | "tree" | "fishing_spot";

/** Authored visual rules shared by every cluster that references a resource. */
export interface ResourcePresentationDef {
  /** Deterministically selected from the entity id. */
  availableAssetIds: readonly string[];
  /** Authored spent state. When absent the renderer may derive a clipped/desaturated fallback. */
  depletedAssetId?: string;
  /** Desired largest world-space dimension in metres. */
  targetWorldSize: number;
  /** Applied after target-size normalisation, with a deterministic value between the endpoints. */
  variantScale?: readonly [number, number];
  /** Vertical offset from the canonical solved water surface. Fishing resources only. */
  waterOffset?: number;
  /** Drives the tier-specific mineral, foliage, or fish treatment in the renderer. */
  materialTier: number;
}

/** A gatherable node archetype: what it yields, what it needs, how long it lasts. */
export interface ResourceDef {
  id: string;
  name: string;
  archetype: GatheringResourceArchetype;
  skill: SkillId;
  tier: number;
  reqLevel: number;
  itemId: ItemId;
  /** Secondary drops, rolled independently per successful gather. */
  bonus?: { itemId: ItemId; chance: number }[];
  /** Optional authored capacity band for exceptional nodes such as essence caches. */
  yieldRange?: readonly [number, number];
  /** Optional exact depletion cooldown, in seconds. */
  respawnSeconds?: number;
  presentation: ResourcePresentationDef;
}

export interface CampfireFuelDef {
  logItemId: ItemId;
  tier: number;
  buildTimeMs: number;
  lifetimeMs: number;
  buildXp: Readonly<{ fletching: number; crafting: number }>;
  visualLogAssetId: string;
}

/**
 * One complete gathering/production unlock row. Systems consume this shape without tier branches,
 * so a later region adds data rather than another gather, production, or campfire implementation.
 */
export interface GatheringProductionTierDef {
  tier: number;
  reqLevel: number;
  metalName: string;
  woodName: string;
  resources: Readonly<{
    mining: readonly string[];
    fishing: string;
    woodcutting: string;
  }>;
  /** Complete authored gathering rows, including presentation and asset references. */
  resourceDefs: readonly ResourceDef[];
  items: Readonly<{
    ore: ItemId; flux: ItemId; gem: ItemId; bar: ItemId;
    log: ItemId; shaft: ItemId; handle: ItemId; hide: ItemId;
    rawFish: ItemId; cookedFish: ItemId; burntFish: ItemId;
    /** Game meat: the hunting counterpart to the fish line, dropped by this tier's animals. */
    rawMeat: ItemId; cookedMeat: ItemId; burntMeat: ItemId;
    dagger: ItemId; sword: ItemId; helm: ItemId; body: ItemId; legs: ItemId;
    boots: ItemId; gloves: ItemId; pickaxe: ItemId; hatchet: ItemId;
    staff: ItemId; wand: ItemId; rod: ItemId; shield: ItemId;
    meleeRing: ItemId; meleePendant: ItemId; magicRing: ItemId; magicCharm: ItemId;
    hood: ItemId; robe: ItemId; magicLegs: ItemId; magicBoots: ItemId; wraps: ItemId;
  }>;
  /** The elemental upgrade unlocked alongside this production tier. */
  magic: Readonly<{
    element: SpellElement;
    essence: ItemId;
    orb: ItemId;
    staff: ItemId;
    wand: ItemId;
    /** Tier-one fallback weapons; the wand is also granted to new characters. */
    basicStaff?: ItemId;
    basicWand?: ItemId;
  }>;
  smelting: Readonly<{ orePerBar: number; fluxPerBar: number }>;
  campfire: CampfireFuelDef;
}

// ------------------------------------------------------------------ recipes

export type RecipeKind =
  | "smelt" | "smith" | "cook" | "craft" | "fletch";

export interface RecipeDef {
  id: RecipeId;
  name: string;
  kind: RecipeKind;
  skill: SkillId;
  reqLevel: number;
  tier: number;
  /** Accepted station kinds. Null means the recipe can be made anywhere. */
  stations: readonly StationKind[] | null;
  inputs: { itemId: ItemId; quantity: number }[];
  output: { itemId: ItemId; quantity: number };
  durationMs: number;
  xp: number;
  /** Cooking only. Burn chance is computed from level; this marks the burnt result. */
  burntItemId?: ItemId;
}

// ------------------------------------------------------------------- spells

export interface SpellDef {
  id: SpellId;
  name: string;
  /** Tint and sound family. Purely presentational; see `SpellElement` for why. */
  element: SpellElement;
  /** Silhouette, scale and particle budget of the effect. See `SpellRung`. */
  rung: SpellRung;
  reqLevel: number;
  tier: number;
  baseMax: number;
  divisor: number;
  baseXp: number;
  castMs: number;
  /**
   * Matching elemental-weapon charge or carried Essence spent per cast, plus the secondary runes
   * an advanced invocation burns: its tier rune, and a Field Rune when it strikes an area.
   */
  cost: { element: SpellElement; charges: number; runes?: readonly SpellRuneCost[] };
  /** 0 (or absent) for the sixteen auto-cast basics; 1 to 5 for the manual invocations. */
  rank?: number;
  /** Strikes an area: several targets, several pulses. Absent means one target, one bolt. */
  aoe?: boolean;
  description: string;
}

export interface SpellRuneCost { itemId: ItemId; quantity: number }

// ------------------------------------------------------------------ enemies

export interface EnemyDef {
  attackStyle?: "melee" | "ranged" | "magic";
  attackRangeM?: number;
  id: string;
  name: string;
  family: string;
  tier: number;
  maxHealth: number;
  attackLevel: number;
  defenceLevel: number;
  accuracy: number;
  armour: number;
  magicArmour: number;
  maxHit: number;
  attackSpeedMs: number;
  aggroRadius: number;
  /**
   * Pursuit speed in metres per second. Omitted means the shared default in `systems/enemyAI.ts`.
   *
   * SET FROM THE ANIMAL'S OWN GAIT, and that is a hard rule rather than a guideline:
   *
   *     moveSpeedMps <= MAX_WALK_CADENCE_HZ * impliedWalkMps * walkClipSeconds
   *
   * `tools/animals/build-animals.ts` measures what ground speed each walk cycle implies and how
   * long the cycle is, and both live in the asset manifest. Their product with the cadence ceiling
   * is the fastest a creature can move while its legs still complete no more than 2.4 cycles a
   * second.
   *
   * CORRECTION. These used to sit at "roughly 1.6x the implied speed", on the reasoning that 1.6x
   * was the fastest a cycle could be played without looking like sped-up film. That is true of a
   * RATE and false of a creature, because the same rate is a different cadence on a different clip:
   * 1.6x on the goat's 0.47 s cycle is 3.4 leg cycles a second, and on the hog's 1.33 s cycle it is
   * 1.2. Tuned that way the roster ended up with a coney at 3.94 Hz, a frog at 3.62 and a goat at
   * 3.35 — all at zero foot slide, and all reported from play as feet moving rapidly and jittering.
   * The speeds are now solved from the inequality instead, so the renderer's cadence cap never has
   * to bite; `tests/creature-gait.test.ts` checks both halves of that.
   *
   * The exceptions are the rigs with no measurable stride — viper, rat, scorpion, crab — whose
   * implied speed is an artefact of a bad clip sub-range rather than a fact about the animal. A
   * snake moving at the 0.05 m/s its measurement implies would be absurd, and a snake has no
   * plantable foot to slide in the first place, so those keep a gameplay speed and lean on the cap.
   */
  moveSpeedMps?: number;
  /**
   * Pottering speed in metres per second, used while a creature is idle and wandering.
   *
   * Separate from `moveSpeedMps` because a walk and a run are separate ANIMATIONS, not one
   * animation at two speeds. `render/entityViews.ts` plays the run cycle while a creature pursues
   * and the walk cycle while it potters, and each is retimed against its own measured stride, so
   * each needs the speed its own clip depicts. Omitted means the creature does not wander.
   */
  walkSpeedMps?: number;
  /** Behaviour selector. Bosses add phases on top. */
  behaviour: "passive" | "aggressive" | "territorial";
  drops: { itemId: ItemId; quantity: [number, number]; chance: number }[];
  /** Currency drop range. */
  marks?: [number, number];
}

// -------------------------------------------------------------------- shops

export interface ShopDef {
  id: string;
  name: string;
  stock: { itemId: ItemId; quantity: number }[];
  /** Multiplier on ItemDef.value when buying from the shop. */
  buyMultiplier: number;
  /** Multiplier on ItemDef.value when selling to the shop. */
  sellMultiplier: number;
}

// ----------------------------------------------------------------- registry

export interface ContentTables {
  items: readonly ItemDef[];
  resources: readonly ResourceDef[];
  recipes: readonly RecipeDef[];
  spells: readonly SpellDef[];
  enemies: readonly EnemyDef[];
  shops: readonly ShopDef[];
}

const EMPTY: ContentTables = { items: [], resources: [], recipes: [], spells: [], enemies: [], shops: [] };

class ContentRegistry {
  private tables: ContentTables = EMPTY;
  private itemsById = new Map<ItemId, ItemDef>();
  private resourcesById = new Map<string, ResourceDef>();
  private recipesById = new Map<RecipeId, RecipeDef>();
  private spellsById = new Map<SpellId, SpellDef>();
  private enemiesById = new Map<string, EnemyDef>();
  private shopsById = new Map<string, ShopDef>();

  /** Called once at boot, before any system ticks. */
  register(tables: Partial<ContentTables>): void {
    this.tables = { ...this.tables, ...tables };
    this.itemsById = new Map(this.tables.items.map((row) => [row.id, row]));
    this.resourcesById = new Map(this.tables.resources.map((row) => [row.id, row]));
    this.recipesById = new Map(this.tables.recipes.map((row) => [row.id, row]));
    this.spellsById = new Map(this.tables.spells.map((row) => [row.id, row]));
    this.enemiesById = new Map(this.tables.enemies.map((row) => [row.id, row]));
    this.shopsById = new Map(this.tables.shops.map((row) => [row.id, row]));
  }

  item(id: ItemId): ItemDef | undefined { return this.itemsById.get(id); }
  resource(id: string): ResourceDef | undefined { return this.resourcesById.get(id); }
  recipe(id: RecipeId): RecipeDef | undefined { return this.recipesById.get(id); }
  spell(id: SpellId): SpellDef | undefined { return this.spellsById.get(id); }
  enemy(id: string): EnemyDef | undefined { return this.enemiesById.get(id); }
  shop(id: string): ShopDef | undefined { return this.shopsById.get(id); }

  allItems(): readonly ItemDef[] { return this.tables.items; }
  allResources(): readonly ResourceDef[] { return this.tables.resources; }
  allRecipes(): readonly RecipeDef[] { return this.tables.recipes; }
  allSpells(): readonly SpellDef[] { return this.tables.spells; }
  allEnemies(): readonly EnemyDef[] { return this.tables.enemies; }
  allShops(): readonly ShopDef[] { return this.tables.shops; }

  /**
   * Every spell of one element, weakest first.
   *
   * The spellbook is the only caller that needs this shape, and it needs it per element rather than
   * per rung: a player picks "I cast fire" once and then wants the strongest fire spell they
   * qualify for, which is the last row here that passes their Magic level.
   */
  spellsOfElement(element: SpellElement): SpellDef[] {
    return this.tables.spells
      .filter((row) => row.element === element)
      .sort((a, b) => a.reqLevel - b.reqLevel);
  }

  /**
   * The strongest spell of an element a Magic level unlocks, or undefined below the first.
   *
   * Level only. Affordability lives in `systems/combat.ts`, which is the layer that can see the
   * pack; a registry that took an inventory port would make content depend on state.
   */
  bestSpellOfElement(element: SpellElement, magicLevel: number): SpellDef | undefined {
    let best: SpellDef | undefined;
    for (const spell of this.tables.spells) {
      if (spell.element !== element) continue;
      if (magicLevel < spell.reqLevel) continue;
      if (!best || spell.reqLevel > best.reqLevel) best = spell;
    }
    return best;
  }

  /** Recipes a station can make, for the production UI. */
  recipesForStation(station: StationKind): RecipeDef[] {
    return this.tables.recipes.filter((row) => row.stations?.includes(station));
  }

  /** Recipes for a skill, ordered by requirement. The skill guide reads this. */
  recipesForSkill(skill: SkillId): RecipeDef[] {
    return this.tables.recipes.filter((row) => row.skill === skill).sort((a, b) => a.reqLevel - b.reqLevel);
  }

  /** Every item that equips into a slot, ordered by tier. */
  equipmentForSlot(slot: EquipSlot): ItemDef[] {
    return this.tables.items.filter((row) => row.equip?.slot === slot).sort((a, b) => a.tier - b.tier);
  }

  isRegistered(): boolean {
    return this.tables.items.length > 0;
  }
}

/** The single shared registry. Import this, not the tables. */
export const content = new ContentRegistry();

// --------------------------------------------------------------- formulas

/** PRD 2.5. Tier-independent on purpose, so an agent can reason about it in one line. */
export function gatherSuccessChance(effectiveLevel: number, reqLevel: number): number {
  return Math.max(0.05, Math.min(0.95, 0.30 + 0.016 * (effectiveLevel - reqLevel)));
}

/** PRD 2.5. XP for one successful gather at a tier. */
export function gatherXp(tier: number): number {
  return Math.round(10 * Math.pow(tier, 0.55));
}

/** PRD 2.6, with the root's correction R3: the low-tier floor is 8, matching the brief's band. */
export function yieldRange(tier: number): readonly [number, number] {
  return [
    Math.max(4, Math.round(8.5 - 0.052 * tier)),
    Math.max(8, Math.round(15 - 0.052 * tier)),
  ];
}

/** PRD 2.6. */
export function respawnSeconds(tier: number): number {
  return Math.round(18 + 3.2 * Math.pow(tier, 0.9));
}

/** PRD 2.7. Food restores this much health. */
export function healAmount(tier: number): number {
  return Math.round(2 + 1.35 * Math.pow(tier, 0.85));
}

/** PRD 2.7. Cooking is the only production skill that can fail. */
export function burnChance(cookingLevel: number, reqLevel: number): number {
  return Math.max(0, Math.min(0.45, 0.45 - 0.030 * (cookingLevel - reqLevel)));
}

/** PRD 2.7. */
export function recipeXp(tier: number, craftWeight: number): number {
  return Math.round(gatherXp(tier) * craftWeight);
}

/**
 * PRD 2.8. Agility XP is 1.8x the gather XP for the tier.
 *
 * Defined on top of the ALREADY-ROUNDED gather XP, not on the raw curve. Rounding once at the end
 * gives 18 / 44 / 64 at tiers 1 / 5 / 10; the PRD's acceptance criteria assert 18 / 43 / 63, which
 * is what composing the rounded values produces. Expressing it in terms of `gatherXp` also makes
 * the relationship explicit rather than re-deriving the same exponent in two places.
 */
export function agilityXp(tier: number): number {
  return Math.round(gatherXp(tier) * 1.8);
}

/** PRD 2.8. */
export function agilitySuccessChance(agilityLevel: number, reqLevel: number): number {
  return Math.max(0.5, Math.min(1, 0.60 + 0.02 * (agilityLevel - reqLevel)));
}

/** PRD 2.5. Tool bonus in effective levels, capped at 40. */
export function toolBonus(tier: number): number {
  return Math.min(40, Math.round(1.6 + 0.75 * tier));
}

/** Sell price is 60% of the item's value, per the frozen ItemDef contract. */
export function sellPrice(value: number): number {
  return Math.round(value * 0.6);
}

// ------------------------------------------------------------ enemy combat level

/**
 * Health the player gains per combat level, from `systems/health.ts`:
 * `maxHealth = 20 + 3 * vitalityLevel`. Reproduced here so the enemy level formula and the
 * player's own health curve cannot drift apart silently.
 */
export const PLAYER_HEALTH_PER_LEVEL = 3;

/**
 * An enemy's displayed combat level, COMPUTED from its stat block. Never authored.
 *
 * The rule this exists to enforce: a level is a reading of the numbers a player actually fights,
 * so it cannot be typed in by hand. Before this, `content/regions.ts` carried a `level` field that
 * was chosen rather than derived, and it disagreed with `enemies.ts` in both directions - the
 * Bracken Fenmite was published as level 3 on 4 health and one damage a swing, while Ordrun was
 * published as level 20 on 200 health and the biggest hit in the game.
 *
 * Three terms, weighted the way a combat level always is: offence counts double what either half
 * of survivability counts, because offence is what kills the player.
 *
 *   offence  = the enemy's attack roll at style factor 1, minus the +9 floor the roll adds to
 *              every combatant. So it is "attack level, with its accuracy bonus folded in", on the
 *              same scale a player's attack level sits on. `systems/combat.ts: attackRoll`.
 *   defence  = the same reading of its defence roll, against the MEAN of armour and magicArmour.
 *              The mean, not either one, because the level is quoted before the player has chosen
 *              which style to bring. `systems/combat.ts: defenceRoll`.
 *   health   = the enemy's health pool expressed in player levels at 3 health per level.
 *
 * Weights are 1/2, 1/4, 1/4 and sum to one, so the result stays on the player's level scale rather
 * than drifting into a score. Checked against the blocks it replaced: the Marchwolf Pup solves to
 * 4 against an authored 4, and the Rill Skitterling to 2 against an authored 2. Where it disagrees
 * it is because the authored number was wrong.
 *
 * `maxHit` and `attackSpeedMs` are deliberately NOT in here. They are already the reason a block's
 * attack level and accuracy are set where they are, and counting damage output twice would make
 * two enemies with identical rolls read as different levels because one holds a bigger stick.
 */
export function enemyCombatLevel(def: {
  attackLevel: number;
  defenceLevel: number;
  accuracy: number;
  armour: number;
  magicArmour: number;
  maxHealth: number;
}): number {
  const offence = (def.attackLevel + 9) * (1 + def.accuracy / 100) - 9;
  const defence = (def.defenceLevel + 9) * (1 + (def.armour + def.magicArmour) / 2 / 100) - 9;
  const health = def.maxHealth / PLAYER_HEALTH_PER_LEVEL;
  return Math.max(1, Math.round(0.5 * offence + 0.25 * defence + 0.25 * health));
}

/**
 * How fast this enemy actually chases, in metres per second.
 *
 * A creature's chase speed is bounded by the clip the chase PLAYS. `render/entityViews.ts` retimes
 * the run cycle to the ground it covers, so asking for more speed than the cycle can carry does not
 * slide the feet - it spins them. Stepping every creature at one shared speed did exactly that:
 * measured against the shipped stride metadata a pursuing goose cycled its legs at 20.3 Hz, a
 * tortoise at 15.4 and a coney at 9.2, against a roster already retuned once because a coney at
 * 3.94 Hz was reported from play as feet moving rapidly and jittering.
 *
 * `CREATURE_PURSUIT_CEILING_MPS` solves that bound off the run cycle. It is deliberately NOT
 * `EnemyDef.moveSpeedMps`, which is solved off the WALK cycle and belongs to pottering: capping a
 * chase with it measures a cadence nothing plays, and lands every goblin, skeleton and golem in the
 * bestiary between 1.2 and 1.6 m/s against a player who runs at 5.2 - which is not a slower monster
 * but no monster, since nothing could ever close on a player who simply walks away.
 *
 * The shared speed stays the ceiling and the default. Off the run cycle it is what almost every
 * hunter keeps: goblins solve to 11.28, golems to 22.53, a grave ghoul to 14.14, skeletons to 5.19.
 * Only the shambling zombies come under it, at 4.08, which is the right shape for a zombie.
 *
 * The stored ceilings are NATIVE, in source-model metres, so they have to be scaled by the same
 * factor `render/entityViews.ts` scales the DRAWN stride by before they mean anything: a goat drawn
 * at 0.75 covers three quarters of the ground its cycle implies, and so cycles its legs a third
 * faster for the same speed over the ground.
 *
 * That factor is `view.scale * tierSilhouetteScale(tier) * buildFor()[2] * view.scaleAxes[2]`. The
 * first, third and fourth are exact here; `buildFor` is not, because it gives each individual a
 * private +-6% hashed from its entity id that content cannot see. The smallest build is assumed, so
 * every larger individual cycles slower than the ceiling rather than faster.
 */
const SMALLEST_BUILD_SCALE = 0.95;

/**
 * Headroom under the ceiling, because the ceiling is a MUST NOT EXCEED rather than a target.
 *
 * Solving a chase to land exactly on 3 Hz leaves nothing for the individual build variation or for
 * a future retiming of the same clip, and a hen came out at 3.0009 Hz - compliant to three decimal
 * places and over the line. One percent of speed buys a bound that stays true.
 */
const PURSUIT_CADENCE_HEADROOM = 0.99;

export function enemyPursuitSpeedMps(
  def: EnemyDef,
  /** The spawned entity's `view`: the rig whose run cycle has to carry the speed, and its size. */
  view: { assetId: string; scale?: number; scaleAxes?: readonly [number, number, number] } | undefined,
  /** The spawned entity's tier. Everything `enemyAI` steps is a tiered archetype. */
  tier: number,
  sharedRunSpeedMps: number,
): number {
  void def;
  const native = view === undefined ? undefined : CREATURE_PURSUIT_CEILING_MPS[view.assetId];
  if (native === undefined || !Number.isFinite(native) || native <= 0) return sharedRunSpeedMps;
  const drawn = Math.abs((view!.scale ?? 1) * tierSilhouetteScale(tier) * (view!.scaleAxes?.[2] ?? 1))
    * SMALLEST_BUILD_SCALE * PURSUIT_CADENCE_HEADROOM;
  if (!Number.isFinite(drawn) || drawn <= 0) return sharedRunSpeedMps;
  return Math.min(sharedRunSpeedMps, native * drawn);
}
