/**
 * What the world bakes actually read.
 *
 * Three committed artifacts are pinned to the authored sources: the world records under
 * `game/public/generated/world`, `game/public/generated/server-world.pack`, and the navigation
 * fingerprint in `game/src/generated/navmeshFingerprint.ts`. A pin that is coarser than the bake
 * makes every content export fail: the export changes one loot drop, the pin moves, and three tests
 * say "Stale world revision" for a bake whose bytes could not have changed.
 *
 * Both narrowings here are measured, not assumed. `tests/bake-inputs.test.ts` recompiles the catalog
 * with real edits applied and checks that loot edits leave the hashed view byte-identical while
 * geometry edits move it.
 */

/**
 * Content sources whose bytes reach no baked artifact, relative to `game/`.
 *
 * `lootTables.json` is inlined by the loot compiler into `creatureByGroup[*].stats.lootRolls`, and
 * that is the only place it lands: decoding the shipped `spawns/world`, `terrain/world`,
 * `scatter/*`, `assembly/*` and `site-cut/*` records and every section of `server-world.pack` finds
 * no `lootRolls`, no drop chance and no loot `itemId`. Baked enemy entities carry combat numbers and
 * `bodyRadius`, never a drop plan.
 *
 * `items.json` deliberately stays: a retired item is filtered out of resource bonus yields, and
 * resource nodes are baked into `assembly/semantic`.
 */
export const NON_BAKE_CONTENT_FILES = ["content/data/lootTables.json"] as const;

interface WorldCreatureStats { readonly [key: string]: unknown }
interface WorldGroupCreature { readonly stats?: WorldCreatureStats; readonly [key: string]: unknown }
interface CompiledWorldTable { readonly creatureByGroup?: Record<string, WorldGroupCreature>; readonly [key: string]: unknown }

/**
 * `catalog.tables.world` without the loot payload.
 *
 * The navigation fingerprint hashes the compiled world table because placement and region geometry
 * are compiler output. But `creatureByGroup` holds each group's resolved creature, loot plan and
 * all, so a single added drop moved `terrainGeometry` and failed the navigation gate for a bake that
 * is geometry only. Dropping `lootRolls` and `gold` takes 111 kB of loot out of the 738 kB table and
 * leaves everything navigation depends on — region bounds, roads, settlements, placements,
 * encounters, resource nodes, habitats, creature `assetId`, `scale` and `bodyRadius`.
 *
 * Key order is preserved, because the hash is taken over `JSON.stringify`.
 */
export function worldGeometryView(world: unknown): unknown {
  const table = world as CompiledWorldTable | null | undefined;
  if (!table?.creatureByGroup) return world;
  const creatureByGroup: Record<string, WorldGroupCreature> = {};
  for (const [group, creature] of Object.entries(table.creatureByGroup)) {
    if (!creature?.stats) { creatureByGroup[group] = creature; continue; }
    const { lootRolls: _loot, gold: _gold, ...stats } = creature.stats;
    creatureByGroup[group] = { ...creature, stats };
  }
  return { ...table, creatureByGroup };
}
