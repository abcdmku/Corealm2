/** One-shot resource migration. Dry run validates the baseline; --apply writes resources.json. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { GatheringProductionTierDef, ResourceDef } from "../../game/src/content/index.js";
import { ResourceSchema, ResourceRecordSchema, RESOURCE_SOURCE_CATALOGS, type ResourceCatalog, type ResourceRecord } from "../../game/src/content/schema/resources.js";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { collectDifferences, type ParityDifference } from "./parity.js";

export type ResourceSourceTables = Readonly<Record<ResourceCatalog, readonly ResourceDef[]>>;

function assertEqual(expected: readonly ResourceDef[], actual: readonly ResourceDef[], source: string): void {
  const differences: ParityDifference[] = [];
  collectDifferences(expected, actual, source, differences);
  if (differences.length) throw new Error(`Resource source parity failed for ${source}:\n${differences.map(difference =>
    `${difference.path}: expected ${difference.expected}, got ${difference.actual}`).join("\n")}`);
}

/** Every resource belongs to exactly one source, and every source retains its original order. */
export function buildResourceRecords(namedSources: ResourceSourceTables, allResources: readonly ResourceDef[]): ResourceRecord[] {
  const all = canonicalRecords(ResourceSchema, allResources, "RESOURCES");
  const allIds = new Set(all.map(row => row.id));
  const membership = new Map<string, ResourceCatalog>();
  const sources = new Map<ResourceCatalog, ResourceDef[]>();
  for (const source of RESOURCE_SOURCE_CATALOGS) {
    if (!Array.isArray(namedSources[source])) throw new Error(`Missing resource source ${source}`);
    const rows = canonicalRecords(ResourceSchema, namedSources[source], source);
    sources.set(source, rows);
    for (const row of rows) {
      if (!allIds.has(row.id)) throw new Error(`${source} resource ${row.id} is absent from RESOURCES`);
      if (membership.has(row.id)) throw new Error(`Resource ${row.id} overlaps sources ${membership.get(row.id)} and ${source}`);
      membership.set(row.id, source);
    }
  }
  const records = canonicalRecords(ResourceRecordSchema, all.map(row => {
    const catalog = membership.get(row.id);
    if (!catalog) throw new Error(`RESOURCES resource ${row.id} has no named source`);
    return { ...row, catalog };
  }), "resources");
  assertEqual(all, records.map(({ catalog: _catalog, ...row }) => row), "RESOURCES");
  for (const source of RESOURCE_SOURCE_CATALOGS) {
    assertEqual(sources.get(source)!, records.filter(row => row.catalog === source).map(({ catalog: _catalog, ...row }) => row), source);
  }
  return records;
}

/** Imports are deferred so the pure builder works without a .baseline directory. */
export async function baselineResources(): Promise<ResourceRecord[]> {
  const names = ["resources", "crownwardFishing", "treeSpecies", "wildernessResources", "fairyOres", "gatheringProductionTiers"];
  const modules = new Map(await Promise.all(names.map(async name => [name,
    await import(pathToFileURL(path.join(repoRoot, ".baseline", "game", "src", "content", `${name}.ts`)).href) as Record<string, unknown>,
  ] as const)));
  const all = modules.get("resources")!.RESOURCES as readonly ResourceDef[];
  const gathering = modules.get("gatheringProductionTiers")!.GATHERING_PRODUCTION_TIERS as readonly GatheringProductionTierDef[];
  const sources = {
    CROWNWARD_FISH_RESOURCES: modules.get("crownwardFishing")!.CROWNWARD_FISH_RESOURCES,
    GATHERING_PRODUCTION_RESOURCES: gathering.flatMap(row => row.resourceDefs),
    HIGH_TIER_TREE_RESOURCES: modules.get("treeSpecies")!.HIGH_TIER_TREE_RESOURCES,
    WILDERNESS_ORE_RESOURCES: modules.get("wildernessResources")!.WILDERNESS_ORE_RESOURCES,
    WILDERNESS_TREE_RESOURCES: modules.get("wildernessResources")!.WILDERNESS_TREE_RESOURCES,
    FAIRY_ORE_RESOURCES: modules.get("fairyOres")!.FAIRY_ORE_RESOURCES,
    FAIRY_TREE_RESOURCES: modules.get("fairyOres")!.FAIRY_TREE_RESOURCES,
  } as Omit<ResourceSourceTables, "ESSENCE_RESOURCES">;
  const namedIds = new Set(Object.values(sources).flatMap(rows => rows.map(row => row.id)));
  const essence = all.filter(row => !namedIds.has(row.id));
  if (essence.some(row => !row.id.startsWith("essence_"))) throw new Error("Unexpected uncatalogued baseline resource");
  return buildResourceRecords({ ...sources, ESSENCE_RESOURCES: essence }, all);
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const args = process.argv.slice(2);
  const unexpected = args.filter(arg => arg !== "--apply");
  if (unexpected.length) throw new Error(`Unknown arguments: ${unexpected.join(", ")}`);
  const records = await baselineResources();
  console.log(`Validated ${records.length} baseline resources and ${RESOURCE_SOURCE_CATALOGS.length} source views.`);
  if (args.includes("--apply")) {
    const changed = await writeContentJson("data/resources.json", records);
    console.log(changed ? "Wrote game/content/data/resources.json" : "game/content/data/resources.json already matches");
  } else console.log("Dry run: no files written. Pass --apply to write baseline records.");
}
