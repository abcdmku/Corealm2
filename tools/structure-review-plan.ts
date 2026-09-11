/** CPU-only finite catalogue inventory. Run with node --import tsx tools/structure-review-plan.ts. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { structureInputHash, type StructureReviewInput } from "./lib/structureReviewInputs.js";
import type { FeatureLabStructureSelection } from "../game/src/contracts.js";
import { REGIONS } from "../game/src/content/regions.js";
import { buildFeatureLabStructureParts, compositionHero, sanitizeFeatureLabStructureSelection } from "../game/src/featureLab/structures.js";
import { BUILDING_KITS, KIT_IDS, PREFAB_IDS, COMPOSITION_IDS, buildWallRun, variantSeed, type PartPlacement, type PrefabId } from "../game/src/render/buildings.js";
import { STRUCTURE_VARIANTS, selectedStructureVariantId, structureVariantCount } from "../game/src/render/structures/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const relative = (file: string): string => path.relative(root, file).replaceAll("\\", "/");
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : /\.(ts|json)$/.test(file) ? [file] : [];
  });
}
const sourceFiles = [...files(path.join(root, "game/src")), path.join(root, "game/public/assets/manifest.json"), fileURLToPath(import.meta.url)];
const fingerprint = (file: string) => ({path:relative(file),sha256:sha(readFileSync(file))});
const supplementalSources = sourceFiles.sort().map(fingerprint);
// Curated appearance boundary: do not recursively follow regionBuilder's unrelated gameplay
// imports, which would invalidate a structure photograph after a quest or hunt-UI edit.
const criticalPaths = [
  "tools/structure-review-plan.ts", "tools/lib/structureReviewInputs.ts", "package-lock.json",
  "runs/corealm-rebuild/checks/finish-structure-catalogue.ts", "runs/corealm-rebuild/checks/finish-gameplay-renderer.ts",
  "game/src/contracts.ts", "game/src/core/rng.ts", "game/src/core/math.ts",
  "game/src/content/regions.ts", "game/src/world/regionBuilder.ts", "game/src/app/config.ts",
  "game/src/world/rootfallStump.ts", "game/src/render/rootfallNavigation.ts", "game/src/render/structureNavigation.ts",
  "game/src/featureLab/structures.ts", "game/src/featureLab/catalog.ts",
  "game/src/render/buildings.ts", "game/src/render/bannerPlacement.ts",
  "game/src/render/assets.ts", "game/src/render/entityViews.ts", "game/src/render/materials.ts",
  "game/src/render/artDirection.ts", "game/src/render/corealmSurfaceMaterials.ts",
  "game/src/render/proceduralTextures.ts", "game/src/render/foliageOcclusion.ts",
  "game/src/render/renderer.ts", "game/src/render/scene.ts", "game/src/render/camera.ts",
];
const textureDirectory = path.join(root,"game/public/assets/textures/corealm");
supplementalSources.push(...readdirSync(textureDirectory).filter(file=>file.endsWith(".png") || file === "corealm-surfaces.json").map(file=>fingerprint(path.join(textureDirectory,file))));
const criticalFiles = new Set([
  ...criticalPaths.map(file=>path.join(root,file)),
  ...files(path.join(root,"game/src/render/structures")),
  ...files(path.join(root,"game/src/render/compositions")),
  ...files(path.join(root,"game/src/content/settlements")),
]);
const sources = [...criticalFiles].sort().map(fingerprint);
const manifest = JSON.parse(readFileSync(path.join(root, "game/public/assets/manifest.json"), "utf8")) as { assets: {id: string; file: string}[] };
const manifestById = new Map(manifest.assets.map(asset => [asset.id, asset]));
const assets = new Map<string, {id: string; path: string; sha256: string; bytes: number; inputs: StructureReviewInput[]}>();
type ReviewCase = {
  key: string; selection: FeatureLabStructureSelection; variant: string | null;
  partsSha256: string; assetIds: string[]; scope: string[]; disposition: "pending";
  hero: ReturnType<typeof compositionHero>; fixtureSupported: boolean; fixtureNotes: string[];
  wallOpenings?: readonly {at: number; width: number}[];
};
const cases: ReviewCase[] = [];
const bySelection = new Map<string, ReviewCase>();
function add(selection: FeatureLabStructureSelection, scope: string, wallOpenings?: readonly {at: number; width: number}[]): void {
  const identity = JSON.stringify([selection, wallOpenings]);
  const existing = bySelection.get(identity);
  if (existing) { existing.scope.push(scope); return; }
  const footprint = [selection.width, selection.depth] as const;
  const parts: PartPlacement[] = selection.kind === "wall-run" && wallOpenings
    ? buildWallRun(selection.width, wallOpenings, BUILDING_KITS[selection.kit], selection.seed)
    : buildFeatureLabStructureParts(selection);
  const hero = selection.kind === "composition" ? compositionHero(selection) : null;
  const assetIds = [...new Set([...parts.map(part => part.assetId), ...(hero ? [hero.assetId] : [])])].sort();
  for (const id of assetIds) {
    if (assets.has(id)) continue;
    const row = manifestById.get(id);
    if (!row) throw new Error(`Missing manifest asset ${id}`);
    const file = path.join(root, "game/public/assets", row.file);
    const bytes = readFileSync(file);
    const entryInput = {path:"game/public/assets/manifest.json",kind:"manifest-entry" as const,id};
    const inputs: StructureReviewInput[] = [{...entryInput,sha256:structureInputHash(entryInput)}];
    // Read actual GLB material names, not descriptive asset tags, for external map membership.
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"));
    const families = new Set<string>();
    for (const material of gltf.materials ?? []) {
      if (material.name === "Bark_Corealm") families.add("bark");
      if (material.name === "Corealm mineral seam" || material.name === "Corealm weathered strata") families.add("stone");
      if (/^Leaves_Corealm(?:_|$)/.test(material.name ?? "")) families.add("leaf");
    }
    for (const family of families) {
      const profile = {path:relative(path.join(textureDirectory,"corealm-surfaces.json")),kind:"surface-profile" as const,id:family};
      inputs.push({...profile,sha256:structureInputHash(profile)});
      for (const suffix of ["", "-normal", "-roughness"]) inputs.push(fingerprint(path.join(textureDirectory,`corealm-${family}${suffix}.png`)));
    }
    for (const image of gltf.images ?? []) if (image.uri && !image.uri.startsWith("data:")) inputs.push(fingerprint(path.resolve(path.dirname(file),image.uri)));
    assets.set(id, {id, path: relative(file), sha256: sha(bytes), bytes: bytes.length, inputs});
  }
  const fixtureNotes: string[] = [];
  if (JSON.stringify(sanitizeFeatureLabStructureSelection(selection)) !== JSON.stringify(selection)) fixtureNotes.push("Lab sanitizes this selection; exact authored dimensions need fixture support.");
  if (wallOpenings && JSON.stringify(wallOpenings) !== JSON.stringify([{at: selection.width / 2, width: selection.depth}])) fixtureNotes.push("Lab only accepts a single centred opening; this production wall case needs opening controls.");
  const entry: ReviewCase = {
    key: `${selection.kind}-${selection.id}-${selection.kit}-${selection.width}x${selection.depth}-${selection.seed}-${sha(identity).slice(0,8)}`,
    selection, variant: selection.kind === "prefab" ? selectedStructureVariantId(selection.id as PrefabId, footprint, selection.seed, BUILDING_KITS[selection.kit]) ?? null : null,
    partsSha256: sha(JSON.stringify(parts)), assetIds, scope: [scope], disposition: "pending", hero,
    fixtureSupported: fixtureNotes.length === 0, fixtureNotes,
    ...(wallOpenings ? {wallOpenings} : {}),
  };
  cases.push(entry); bySelection.set(identity, entry);
}

for (const region of REGIONS) {
  if (!region.settlement) continue;
  for (const building of region.settlement.buildings) add({kind: "prefab", id: building.prefab, kit: region.settlement?.kit ?? "stone", width: building.footprint[0], depth: building.footprint[1], seed: variantSeed(building.id)}, `authored:${region.id}:${building.id}`);
  for (const wall of region.settlement.walls ?? []) add({kind: "wall-run", id: "wall_run", kit: region.settlement?.kit ?? "stone", width: Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]), depth: 4, seed: variantSeed(wall.id)}, `authored-wall:${region.id}:${wall.id}`, wall.openings ?? []);
}
const footprints = [[6,4],[6,6],[12,6],[5,4],[4,4],[8,1],[3,2],[8,3],[8,4],[6,3],[6,5],[4,3],[9,3],[2,2],[10,4],[16,3],[10,6]] as const;
const witnessed = new Set<string>();
for (const prefab of PREFAB_IDS) for (const kit of KIT_IDS) for (const footprint of footprints) {
  const count = structureVariantCount(prefab, footprint, BUILDING_KITS[kit]);
  for (let seed = 0; seed < count; seed++) {
    const variant = selectedStructureVariantId(prefab, footprint, seed, BUILDING_KITS[kit])!;
    const key = `${variant}:${kit}`;
    if (witnessed.has(key)) continue;
    witnessed.add(key);
    add({kind: "prefab", id: prefab, kit, width: footprint[0], depth: footprint[1], seed}, `named-variant:${variant}:${kit}`);
  }
}
const extras: readonly [PrefabId, number, number][] = [["townhouse",8,4],["porch",8,3],["farmstead",8,4],["tower",4,4],["gatehouse",8,3],["gatehouse",8,4],["arcade",16,3],["stall",3,2]];
for (const [id,width,depth] of extras) for (const kit of KIT_IDS) {
  const count = Math.max(1, structureVariantCount(id,[width,depth],BUILDING_KITS[kit]));
  for (let seed=0; seed<count; seed++) add({kind:"prefab",id,kit,width,depth,seed}, "extra-footprint-branch");
}
for (const id of COMPOSITION_IDS) for (const kit of KIT_IDS) for (let seed=0;seed<6;seed++) add({kind:"composition",id,kit,width:6,depth:4,seed}, "finite-composition-seed-witness");
for (const kit of KIT_IDS) for (const [width,depth] of [[18,4],[18,6],[26,4],[30,8]] as const) for (let seed=0;seed<6;seed++) add({kind:"wall-run",id:"wall_run",kit,width,depth,seed}, "finite-wall-seed-witness");
const visited = new Set(cases.map(entry=>entry.variant).filter(Boolean));
const missing = STRUCTURE_VARIANTS.filter(entry=>!visited.has(entry.id)).map(entry=>entry.id);
if (missing.length) throw new Error(`Named variants lack witnesses: ${missing.join(", ")}`);
// Keep the complete finite inventory while exposing a bounded visual review queue.
// Geometry equivalence is useful for queue planning, but never transfers regional materials,
// navigation or world-grounding acceptance between placements.
const representative = new Set<string>();
const representativeVariants = new Set<string>();
for (const entry of cases.filter(entry => entry.scope.some(scope => scope.startsWith("authored:")))) {
  representative.add(entry.key);
  if (entry.variant) representativeVariants.add(entry.variant);
}
for (const entry of cases) if (entry.variant && !representativeVariants.has(entry.variant)) {
  representative.add(entry.key); representativeVariants.add(entry.variant);
}
const proofGroupsByHash = new Map<string, {key: string; partsSha256: string; hero: ReturnType<typeof compositionHero>; caseKeys: string[]}>();
for (const entry of cases) {
  const key = sha(JSON.stringify({partsSha256:entry.partsSha256,hero:entry.hero}));
  let group = proofGroupsByHash.get(key);
  if (!group) {
    group = {key,partsSha256:entry.partsSha256,hero:entry.hero,caseKeys:[]};
    proofGroupsByHash.set(key,group);
  }
  group.caseKeys.push(entry.key);
}
const representedCompositionGeometry = new Set<string>();
for (const entry of cases) if (entry.selection.kind === "composition") {
  const geometry = sha(JSON.stringify({partsSha256:entry.partsSha256,hero:entry.hero}));
  if (representedCompositionGeometry.has(geometry)) continue;
  representative.add(entry.key); representedCompositionGeometry.add(geometry);
}
// Three finite decorative seeds for each kit's compact centred-opening wall fixture.
for (const entry of cases) if (entry.selection.kind === "wall-run" && entry.fixtureSupported && entry.selection.width === 18 && entry.selection.depth === 4 && entry.selection.seed < 3) representative.add(entry.key);
const plan = {
  schemaVersion: 2, createdAt: new Date().toISOString(), sources, supplementalSources, assets: [...assets.values()].sort((a,b)=>a.id.localeCompare(b.id)), cases,
  representativeCaseKeys:[...representative],
  proofGroups:[...proofGroupsByHash.values()],
  inactiveAssets: ["bridge_small", "bridge_modular_end", "bridge_modular_center"].map(id => ({
    id, disposition: "retired-from-active-review", reason: "No game/src production reference. Legacy Ultimate Platformer assets remain in the build catalogue and public files during active integration; root approved scope retirement. Active authored crossings are reviewed through traversal fixtures.",
  })),
  coverage: {namedVariants: STRUCTURE_VARIANTS.length, witnessedNamedVariants: visited.size, namedVariantKitWitnesses: witnessed.size, caseCount:cases.length, authoredBuildings:REGIONS.reduce((sum,region)=>sum+(region.settlement?.buildings.length ?? 0),0), compositionSeedWitnesses:[0,1,2,3,4,5], missingNamedVariants:missing, uniquePartHashes:new Set(cases.map(entry=>entry.partsSha256)).size, representativeCases:representative.size, representativeNamedVariants:representativeVariants.size, representativeCompositionGeometries:representedCompositionGeometry.size, proofGroups:proofGroupsByHash.size},
  limitations: [
    "Finite branch witnesses only. Arbitrary random seeds and continuous footprint domains are not exhaustively covered.",
    "Representative queue includes every authored building selection, at least one witness per named variant, each exact composition geometry+hero combination in this finite inventory, and nine compact wall witnesses. Other cases remain inventoried and unreviewed.",
    "Proof groups mean exact production parts plus hero metadata equivalence only. They do not transfer screenshot approval across materials/kits, region tiers, world placement, collisions, or asset/source revisions. No group is accepted merely because it exists.",
    "All dispositions are pending. Generating this plan supplies no visual, browser, collision, grounding, or gameplay acceptance.",
    "Part hashes cover production recipe placements; hero metadata and hero GLB hashes are separate. Terrain transforms and world placement are outside these hashes.",
    "Lab kit determines region and tier; authored region overrides require fixture support and separate world proof.",
    "Vault-door fixture includes the authored enclosing Coldbrace tower host. Three unused legacy bridge assets are retired from active review with root approval; active authored crossings remain in traversal acceptance.",
    "Unsupported wall opening layouts and sanitized dimensions are retained with fixtureSupported:false; runners must skip them explicitly.",
    "Critical sources are an explicit appearance dependency boundary: geometry/catalogues, authored settlements, part emission/fixture, loaders/materials/renderer/camera, shared contracts/math, lockfile. Each used manifest entry, actual GLB bytes and material-selected external surface family/profile/maps are fingerprinted per asset; unrelated catalogue entries/maps are supplemental only. Regenerate after any critical source or asset change.",
    "supplementalSources preserves the broader game/src snapshot for provenance only; unrelated gameplay/UI changes do not invalidate a capture automatically. This is a curated appearance boundary, not a complete transitive runtime import closure. Changes to fixture orchestration, lighting controls or capture settings outside this boundary still require reviewer assessment.",
  ],
};
const output = path.join(root,"art/rebuild/candidates/finish-structures/catalogue-plan.json");
mkdirSync(path.dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(plan,null,2)+"\n");
console.log(JSON.stringify({output:relative(output),...plan.coverage}));
