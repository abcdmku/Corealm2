/**
 * The part of a compiled catalog that shapes a baked world: terrain, solids, navigation and scatter.
 *
 * `worldGeometryRevision` (`serverWorldContract.ts`) combines the build's code revision with a hash of
 * this view, so a publish that only renames an item, changes a drop or retunes a creature's numbers
 * leaves the revision alone and bakes nothing, while one that moves terrain, a region, a placement,
 * a habitat, a resource's model or a creature's body bakes a new world.
 *
 * What is left out, and why each is safe:
 *  - `items`: no item reaches terrain, solids, the navmesh or the tree scatter. The client's
 *    semantic record repeats bonus yields, but a server replicates its own entities.
 *  - resource numbers (`name`, `skill`, `tier`, `reqLevel`, `itemId`, `yieldRange`, `respawnSeconds`, `bonus`):
 *    a node's footprint and model come from `id`, `archetype` and `presentation`, which stay.
 *  - region `name` and `lore`, encounter and spawn group `name`: labels.
 *  - each spawn group's creature `stats` (combat numbers, names, the loot plan): the body that is
 *    placed is `assetId`, `scale` and `bodyRadius`, which stay.
 *
 * Browser-safe and pure: devdocs may compute it to say whether a draft would bake.
 */

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] | null => Array.isArray(value) ? value as Row[] : null;
const omit = (row: Row, keys: readonly string[]): Row => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

const RESOURCE_NUMBERS = ["name", "skill", "tier", "reqLevel", "itemId", "yieldRange", "respawnSeconds", "bonus"] as const;
const LABELS = ["name", "lore"] as const;

/** The geometry view of `catalog.tables`. Key order follows the tables, because the hash is taken over `JSON.stringify`. */
export function geometryContentView(tables: Readonly<Record<string, unknown>>): unknown {
  const world = tables.world as Row | null | undefined;
  const creatures = world?.creatureByGroup as Record<string, Row> | undefined;
  return {
    worldTerrain: tables.worldTerrain ?? null,
    world: world ? {
      ...world,
      ...(rows(world.regions) ? { regions: rows(world.regions)!.map(region => omit(region, LABELS)) } : {}),
      ...(rows(world.encounters) ? { encounters: rows(world.encounters)!.map(encounter => omit(encounter, LABELS)) } : {}),
      ...(world.groupsByRegion && typeof world.groupsByRegion === "object" ? { groupsByRegion: Object.fromEntries(Object.entries(world.groupsByRegion as Record<string, unknown>)
        .map(([region, groups]) => [region, rows(groups)?.map(group => omit(group, LABELS)) ?? groups])) } : {}),
      ...(creatures ? { creatureByGroup: Object.fromEntries(Object.entries(creatures).map(([group, creature]) => [group, creature ? omit(creature, ["stats"]) : creature])) } : {}),
    } : null,
    resources: rows(tables.resources)?.map(resource => omit(resource, RESOURCE_NUMBERS)) ?? null,
  };
}

/** SHA-256 hex of the geometry view: the `geometryContentHash` that `worldGeometryRevision` takes. */
export async function geometryContentHash(tables: Readonly<Record<string, unknown>>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(geometryContentView(tables))));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
