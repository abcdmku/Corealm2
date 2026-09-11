/**
 * Generates the public game guide from the canonical content tables.
 *
 * The Markdown and the website consume the same output. Screenshots are produced separately by
 * tools/capture-docs.ts from the running Chromium game, then referenced here by stable content id.
 *
 * Usage: npx tsx tools/gen-docs.ts [--out docs/game] [--provenance-out docs/asset-provenance-gathering.md]
 */
import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { argValue, repoRoot } from "./lib/paths.js";
import { ccAssetCredits } from "./lib/cc-asset-license.js";
import { isSupportedCcAttributionLicense, validateCcAssetPack } from "../game/src/content/assetLicenses.js";

import {
  burnChance,
  content,
  gatherXp,
  respawnSeconds,
  sellPrice,
  toolBonus,
  yieldRange,
  type EnemyDef,
} from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";
import { RESOURCES, RESOURCE_ARCHETYPES } from "../game/src/content/resources.js";
import { RECIPES } from "../game/src/content/recipes.js";
import { SPELLS } from "../game/src/content/spells.js";
import { ENEMIES, ENEMY_BLOCKS } from "../game/src/content/enemies.js";
import { SHOPS } from "../game/src/content/shops.js";
import {
  QUESTS,
  type QuestDef,
  type QuestGrant,
  type QuestStageDef,
} from "../game/src/content/quests.js";
import { NPCS, npc, npcGivingQuest } from "../game/src/content/npcs.js";
import {
  REGIONS,
  type EnemyGroupDef,
  type LocationDef,
} from "../game/src/content/regions.js";
import { SKILLS } from "../game/src/content/skills.js";
import { MAX_LEVEL, TIERS, totalXpAt, xpTable } from "../game/src/content/xp.js";
import { WORLD_MAP_IMAGE_BOUNDS } from "../game/src/generated/worldMapFingerprint.js";
import { itemIsReleased, itemTooltipContent } from "../game/src/ui/itemTooltipContent.js";
import type { RegionId, SkillId } from "../game/src/contracts.js";
import type { AssetManifest, AssetPack } from "../game/src/render/assets.js";

function cleanCell(value: string | number): string {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.map(cleanCell).join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(cleanCell).join(" | ")} |`).join("\n");
  return [head, rule, body].join("\n");
}

function page(title: string, description: string, body: string): string {
  return [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
}

function skillName(id: SkillId): string {
  return SKILLS[id]?.name ?? id;
}

function itemName(id: string): string {
  return content.item(id)?.name ?? id;
}

function itemForGuide(id: string): typeof ALL_ITEMS[number] {
  const item = ALL_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`The gathering and production catalog references unknown item ${id}.`);
  return item;
}

type GatheringProductionTier = (typeof GATHERING_PRODUCTION_TIERS)[number];

function resourceForGuide(id: string): typeof RESOURCE_ARCHETYPES[number] {
  const resource = RESOURCE_ARCHETYPES.find((candidate) => candidate.id === id);
  if (!resource) throw new Error(`The gathering and production catalog references unknown resource ${id}.`);
  return resource;
}

export function resourceGuideLifecycle(resourceId: string): {
  xpEach: number;
  perNode: string;
  recovery: string;
} {
  const resource = resourceForGuide(resourceId);
  const [low, high] = resource.yieldRange ?? yieldRange(resource.tier);
  return {
    xpEach: gatherXp(resource.tier),
    perNode: `${low}-${high}`,
    recovery: `${resource.respawnSeconds ?? respawnSeconds(resource.tier)} s respawn`,
  };
}

const ARCHIVE_SHA256 = /^[a-f0-9]{64}$/;
const ORIGINAL_GENERATORS = new Set(["tools/build-corealm-nature.ts", "tools/build-corealm-geology.ts", "tools/build-corealm-farm.ts", "tools/build-corealm-minerals.ts", "tools/build-ground-ores.ts", "tools/build-creature-expansion.ts", "tools/build-corealm-equipment.ts", "tools/wilderness-trees/build.ts", "tools/wilderness-creatures/keepers/hollow-star.mjs"]);
ORIGINAL_GENERATORS.add('tools/wilderness-resources/build.ts');
const FOUNDATION_IMPORT_PACK_IDS = new Set(["ultimate-nature-pack", "animated-fish-pack"]);

const APPROVED_GATHERING_ASSET_CANDIDATES = [
  {
    name: "Animated Cute Fish Pack",
    source: "https://quaternius.com/packs/cutefish.html",
    use: "More fish species, rods, and lures",
  },
  {
    name: "Ultimate RPG Pack",
    source: "https://quaternius.com/packs/ultimaterpg.html",
    use: "Later weapon and prop silhouettes",
  },
  {
    name: "Survival Pack",
    source: "https://quaternius.com/packs/survival.html",
    use: "Later camps and survival props",
  },
  {
    name: "Ultimate Stylized Nature Pack",
    source: "https://quaternius.com/packs/ultimatestylizednature.html",
    use: "Later biome vegetation and textured nature assets",
  },
] as const;

interface FoundationAssetReference {
  assetId: string;
  uses: string[];
}

function code(value: string): string {
  return `\`${value}\``;
}

function isGroundOreDerivative(pack: AssetPack): boolean {
  return pack.id === "corealm-original-ground-ores" && pack.source === "tools/build-ground-ores.ts"
    && pack.license.startsWith("Derivative geometry and material maps") && pack.license.includes("Standard Unity Asset Store EULA");
}

function packLink(pack: AssetPack): string {
  const source = pack.license === "LicenseRef-Corealm-Original" || isGroundOreDerivative(pack) ? `../${pack.source}` : pack.source;
  return `[${pack.name}](${source})`;
}

function packIntegrityProof(pack: AssetPack): string {
  if (pack.license === "LicenseRef-Corealm-Original" || isGroundOreDerivative(pack)) return `Generator SHA-256: ${code(pack.generatorSha256!)}`;
  return pack.archiveSha256 ? `Archive SHA-256: ${code(pack.archiveSha256)}` : "Per-file SHA-256 audit";
}

export function validateManifestPack(pack: AssetPack, manifest: AssetManifest): void {
  if (isGroundOreDerivative(pack)) {
    const reference = (pack as AssetPack & { sourceReference?: {
      assetId: string; file: string; pack: string; sha256: string; license: string; upstreamSource: string; upstreamLicense: string;
    } }).sourceReference;
    const upstream = manifest.packs.find((entry) => entry.id === reference?.pack);
    const asset = manifest.assets.find((entry) => entry.id === reference?.assetId);
    if (!reference || reference.pack !== "dexsoft-rocks-free" || reference.assetId !== "rocks_free_essence_node"
      || asset?.pack !== reference.pack || !upstream?.license.startsWith("Standard Unity Asset Store EULA")
      || !/^https?:\/\//.test(upstream.source) || !reference.license.includes("Standard Unity Asset Store EULA")
      || reference.upstreamSource !== upstream.source || reference.upstreamLicense !== upstream.license
      || !ARCHIVE_SHA256.test(reference.sha256)) {
      throw new Error(`Derivative asset pack ${pack.id} requires the pinned licensed DEXSOFT source reference.`);
    }
    const file = path.resolve(repoRoot, "game/public/assets", asset.file);
    const relative = path.relative(path.resolve(repoRoot, "game/public/assets"), file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || path.resolve(repoRoot, reference.file) !== file
      || createHash("sha256").update(readFileSync(file)).digest("hex") !== reference.sha256) {
      throw new Error(`Derivative asset pack ${pack.id} source asset SHA-256 or path does not match.`);
    }
    if (!pack.generatorSha256 || !ARCHIVE_SHA256.test(pack.generatorSha256)
      || createHash("sha256").update(readFileSync(path.join(repoRoot, pack.source))).digest("hex") !== pack.generatorSha256) {
      throw new Error(`Derivative asset pack ${pack.id} generator SHA-256 does not match.`);
    }
    return;
  }
  if (pack.license === "LicenseRef-Corealm-Original") {
    if (!ORIGINAL_GENERATORS.has(pack.source)) {
      throw new Error(`Original asset pack ${pack.id} has no recognized repository generator.`);
    }
    if (!pack.generatorSha256 || !ARCHIVE_SHA256.test(pack.generatorSha256)) {
      throw new Error(`Original asset pack ${pack.id} has no valid lowercase generator SHA-256.`);
    }
    const source = readFileSync(path.join(repoRoot, pack.source));
    const actual = createHash("sha256").update(source).digest("hex");
    if (actual !== pack.generatorSha256) {
      throw new Error(`Original asset pack ${pack.id} generator SHA-256 does not match ${pack.source}.`);
    }
    return;
  }
  if (!/^https?:\/\//.test(pack.source)) {
    throw new Error(`Asset pack ${pack.id} has no reproducible HTTP(S) source.`);
  }
  const isCc0 = pack.license === "CC0-1.0";
  if (isSupportedCcAttributionLicense(pack.license)) {
    validateCcAssetPack(pack);
    return;
  }
  const isUnityStoreAsset = pack.license.startsWith("Standard Unity Asset Store EULA");
  if (!isCc0 && !isUnityStoreAsset) {
    throw new Error(`Asset pack ${pack.id} has unsupported license ${pack.license}.`);
  }
  if (isCc0 && (!pack.archiveSha256 || !ARCHIVE_SHA256.test(pack.archiveSha256))) {
    throw new Error(`Asset pack ${pack.id} has no valid lowercase archive SHA-256.`);
  }
}

function foundationAssetReferences(
  tiers: readonly GatheringProductionTier[],
): FoundationAssetReference[] {
  const usesByAsset = new Map<string, Set<string>>();
  const add = (assetId: string, use: string): void => {
    const uses = usesByAsset.get(assetId) ?? new Set<string>();
    uses.add(use);
    usesByAsset.set(assetId, uses);
  };

  for (const definition of tiers) {
    for (const resource of definition.resourceDefs) {
      for (const assetId of resource.presentation.availableAssetIds) {
        add(assetId, `Level ${definition.reqLevel} ${resource.id}, available`);
      }
      if (resource.presentation.depletedAssetId) {
        add(resource.presentation.depletedAssetId, `Level ${definition.reqLevel} ${resource.id}, depleted`);
      }
    }
    add(
      definition.campfire.visualLogAssetId,
      `Level ${definition.reqLevel} campfire, ${definition.campfire.logItemId}`,
    );
  }

  return [...usesByAsset]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([assetId, uses]) => ({ assetId, uses: [...uses] }));
}

function naturalList(values: readonly (string | number)[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return String(values[0]);
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

/**
 * Generates the checked-in gathering provenance report from the runtime manifest and tier catalog.
 * The manifest timestamp is deliberately ignored so an identical asset catalog produces identical
 * Markdown after a rebuild.
 */
export function gatheringAssetProvenanceDoc(
  manifest: AssetManifest,
  tiers: readonly GatheringProductionTier[] = GATHERING_PRODUCTION_TIERS,
): string {
  const orderedTiers = [...tiers].sort((left, right) => left.reqLevel - right.reqLevel);
  const packs = [...manifest.packs].sort((left, right) => left.id.localeCompare(right.id));
  const assets = [...manifest.assets].sort((left, right) => left.id.localeCompare(right.id));
  const packsById = new Map(packs.map((pack) => [pack.id, pack] as const));
  const assetsById = new Map(assets.map((asset) => [asset.id, asset] as const));
  const references = foundationAssetReferences(orderedTiers);

  if (packsById.size !== packs.length) throw new Error("The runtime manifest has duplicate pack IDs.");
  if (assetsById.size !== assets.length) throw new Error("The runtime manifest has duplicate asset IDs.");
  for (const pack of packs) validateManifestPack(pack, manifest);
  for (const asset of assets) {
    if (!packsById.has(asset.pack)) {
      throw new Error(`Runtime manifest asset ${asset.id} references missing pack ${asset.pack}.`);
    }
  }
  for (const reference of references) {
    const asset = assetsById.get(reference.assetId);
    if (!asset) throw new Error(`Gathering provenance references missing manifest asset ${reference.assetId}.`);
    if (!packsById.has(asset.pack)) {
      throw new Error(`Gathering provenance asset ${asset.id} references missing pack ${asset.pack}.`);
    }
  }

  const assetCountByPack = new Map<string, number>();
  for (const asset of assets) assetCountByPack.set(asset.pack, (assetCountByPack.get(asset.pack) ?? 0) + 1);
  const referenceCountByPack = new Map<string, number>();
  for (const reference of references) {
    const packId = assetsById.get(reference.assetId)!.pack;
    referenceCountByPack.set(packId, (referenceCountByPack.get(packId) ?? 0) + 1);
  }

  const packRows = packs.map((pack) => [
    code(pack.id),
    packLink(pack),
    pack.author,
    pack.license,
    packIntegrityProof(pack),
    assetCountByPack.get(pack.id) ?? 0,
    referenceCountByPack.get(pack.id) ?? 0,
  ]);

  const presentationRows = orderedTiers.flatMap((definition) => definition.resourceDefs.map((resource) => [
    definition.reqLevel,
    `${resource.name} (${code(resource.id)})`,
    skillName(resource.skill),
    resource.presentation.availableAssetIds.map(code).join(", "),
    resource.presentation.depletedAssetId
      ? code(resource.presentation.depletedAssetId)
      : resource.archetype === "ore"
        ? "Procedural worked scar"
        : "Procedural recovery ripple",
    `${resource.presentation.targetWorldSize} m`,
    resource.presentation.waterOffset === undefined ? "-" : `${resource.presentation.waterOffset} m`,
    resource.presentation.materialTier,
  ]));

  const campfireRows = orderedTiers.map((definition) => {
    const fuel = definition.campfire;
    const asset = assetsById.get(fuel.visualLogAssetId)!;
    const pack = packsById.get(asset.pack)!;
    return [
      definition.reqLevel,
      code(fuel.logItemId),
      code(fuel.visualLogAssetId),
      code(pack.id),
      packLink(pack),
      pack.license,
      packIntegrityProof(pack),
      `${fuel.lifetimeMs / 1_000} s`,
    ];
  });

  const referenceRows = references.map((reference) => {
    const asset = assetsById.get(reference.assetId)!;
    const pack = packsById.get(asset.pack)!;
    return [
      code(reference.assetId),
      reference.uses.join("; "),
      code(pack.id),
      packLink(pack),
      pack.license,
      packIntegrityProof(pack),
    ];
  });

  const importedPacks = packs.filter((pack) => FOUNDATION_IMPORT_PACK_IDS.has(pack.id));
  for (const packId of FOUNDATION_IMPORT_PACK_IDS) {
    if (!packsById.has(packId)) {
      throw new Error(`Gathering provenance import pack ${packId} is missing from the runtime manifest.`);
    }
  }
  const importedRows = importedPacks.map((pack) => {
    const importedReferences = references
      .filter((reference) => assetsById.get(reference.assetId)?.pack === pack.id)
      .map((reference) => code(reference.assetId));
    return [
      code(pack.id),
      packLink(pack),
      pack.license,
      packIntegrityProof(pack),
      importedReferences.join(", "),
    ];
  });

  const candidateRows = APPROVED_GATHERING_ASSET_CANDIDATES.map((candidate) => [
    `[${candidate.name}](${candidate.source})`,
    "Pack page states CC0",
    candidate.use,
    "Approved candidate, do not import yet",
  ]);

  return [
    "# Gathering asset provenance",
    "",
    "This report is generated by `npm run gen-docs`. It reads `game/public/assets/manifest.json` and the canonical gathering tier catalog. Do not edit its tables by hand.",
    "",
    `The runtime manifest contains ${assets.length} assets from ${packs.length} packs. The levels ${naturalList(orderedTiers.map((tier) => tier.reqLevel))} foundation catalog references ${references.length} distinct manifest assets. Original Corealm packs link to their repository generators, whose SHA-256 values are checked against the current source files. CC0 source archives use pinned SHA-256 values; approved free Unity Asset Store imports use audited per-file SHA-256 values recorded in the manifest.`,
    "",
    "## Runtime pack catalog",
    "",
    table(
      ["Pack ID", "Pack and source", "Author", "License", "Integrity proof", "Runtime assets", "Foundation assets"],
      packRows,
    ),
    ...packs.filter((pack) => isSupportedCcAttributionLicense(pack.license)).flatMap((pack) => ["", ccAssetCredits(pack)]),
    "",
    "## Canonical resource presentation",
    "",
    "Available and depleted appearances come straight from each tier's resource definition. Ore and fish use explicit renderer treatments when they do not name a separate depleted mesh.",
    "",
    table(
      ["Level", "Resource", "Skill", "Available assets", "Depleted appearance", "Target size", "Water offset", "Material tier"],
      presentationRows,
    ),
    "",
    "The three `rock_medium` meshes retain their authored diffuse material. The resource renderer scales them to the target size above, adds embedded tier-coloured fractures, and replaces the bright fracture treatment with worked scars after depletion.",
    "",
    "## Campfire log provenance",
    "",
    table(
      ["Level", "Log item", "Visual asset", "Pack ID", "Pack and source", "License", "Integrity proof", "Lifetime"],
      campfireRows,
    ),
    "",
    "Campfires combine the listed log mesh with existing small rocks and the shared flame, smoke, and crackle layers. Held staffs and wands use the audited FREE - RPG Weapons meshes; the fishing rod, line, and bobber still come from the procedural gear renderer.",
    "",
    "## Foundation asset references",
    "",
    table(["Asset ID", "Canonical use", "Pack ID", "Pack and source", "License", "Integrity proof"], referenceRows),
    "",
    "## Imported for this foundation",
    "",
    "The build converts the selected OBJ and MTL sources to self-contained GLB files before its normal optimization pass. Fish movement is procedural, so the static fish meshes are sufficient.",
    "",
    table(["Pack ID", "Pack and source", "License", "Integrity proof", "Referenced assets"], importedRows),
    "",
    "## Approved later candidates",
    "",
    "These packs are CC0 candidates for later regions. They are not in the runtime manifest.",
    "",
    table(["Pack", "License check", "Possible later use", "Decision"], candidateRows),
    "",
    "Approval is not an import. A later region must pin the downloaded archive hash, curate the required models, regenerate this report, and repeat the visual and license checks.",
    "",
    "## Approved Unity Asset Store imports",
    "",
    "[FREE - RPG Weapons](https://assetstore.unity.com/packages/3d/props/weapons/free-rpg-weapons-199738) supplies the held staff and wand meshes. [DEXSOFT Rocks FREE pack](https://assetstore.unity.com/packages/3d/props/exterior/rocks-free-pack-98219) supplies the essence cache and satellite-node meshes. Both are recorded under the Standard Unity Asset Store EULA and validated by `tools/import-unity-magic-assets.ts` against their expected per-file hashes, bounds, embedded textures, and non-emissive source materials.",
    "",
    "## Reproduce the import",
    "",
    "Original Corealm packs are generated locally, without a downloaded archive. Run their linked generator scripts from the repository root:",
    "",
    "```text",
    "npx tsx tools/build-corealm-nature.ts",
    "npx tsx tools/build-corealm-geology.ts",
    "```",
    "",
    "Use the pinned archives in `.asset-cache`, then run:",
    "",
    "```text",
    "npm run build-assets -- --check",
    "npm run build-assets",
    "npm run build-assets -- --verify",
    "npm run gen-docs",
    "```",
    "",
    "The archive check must fail if a pinned hash changes. The build must emit parseable, non-empty GLB files. Inspect the resulting rocks, stumps, logs, fish, and campfires in Chromium because a valid GLB does not prove readable scale, placement, or depletion states.",
    "",
  ].join("\n");
}

function recipesAtTier(tier: number, skill: SkillId): typeof RECIPES[number][] {
  return RECIPES.filter((recipe) => recipe.tier === tier && recipe.skill === skill);
}

function recipeForOutput(
  definition: GatheringProductionTier,
  itemId: string,
): typeof RECIPES[number] {
  const recipe = RECIPES.find((candidate) =>
    candidate.tier === definition.tier && candidate.output.itemId === itemId);
  if (!recipe) {
    throw new Error(`Tier ${definition.tier} has no recipe that produces ${itemId}.`);
  }
  return recipe;
}

function recipeIngredients(recipe: typeof RECIPES[number]): string {
  return recipe.inputs
    .map((input) => `${input.quantity}× ${itemName(input.itemId)}`)
    .join(" + ");
}

function recipeResult(recipe: typeof RECIPES[number]): string {
  return `${recipe.output.quantity}× ${itemName(recipe.output.itemId)}`;
}

function recipeStations(recipe: typeof RECIPES[number]): string {
  return recipe.stations?.map(humanizeId).join(" / ") ?? "Anywhere";
}

function elementName(element: string): string {
  return element === "wind" ? "Air" : `${element[0]?.toUpperCase() ?? ""}${element.slice(1)}`;
}

function itemIcon(id: string, label = itemName(id), base = "./"): string {
  return `![${label}](${base}assets/items/${id}.png)`;
}

type CaptureKind = "npc" | "enemy" | "enemyGroup" | "entity" | "location";

function captureAsset(kind: CaptureKind, id: string, base = "./"): string {
  const folder = {
    npc: "npcs",
    enemy: "enemies",
    enemyGroup: "enemy-groups",
    entity: "entities",
    location: "locations",
  }[kind];
  return `${base}assets/captures/${folder}/${id}.webp`;
}

function publicCaptureAsset(kind: CaptureKind, id: string, base: string): string {
  return captureAsset(kind, id, base);
}

function capture(kind: CaptureKind, id: string, label: string, base = "./"): string {
  // Astro's content pipeline fails the whole site build on a relative image that is missing, so
  // content that has not been captured yet (see tools/capture-docs.ts) simply gets no picture.
  if (!existsSync(path.resolve(repoRoot, "docs/game", captureAsset(kind, id, "")))) return "";
  return `![${label}](${captureAsset(kind, id, base)})`;
}

export function itemLink(id: string, label = itemName(id), base = "../"): string {
  return `[${label}](${base}items/${id}/)`;
}

function humanizeId(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function headingSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function regionName(id: RegionId): string {
  if (id === "gravelmaw") return "Gravelmaw";
  return REGIONS.find((region) => region.id === id)?.name ?? id;
}

interface PlaceRecord {
  location: LocationDef;
  regionId: RegionId;
  regionLabel: string;
  tier: number;
}

interface MapPoint {
  id: string;
  label: string;
  context: string;
  kind: string;
  position: readonly [number, number];
  href: string;
}

interface AuthoredEntityPoint {
  id: string;
  name: string;
  position: readonly [number, number];
  regionId: RegionId;
}

interface ResolvedEnemyGroup {
  group: EnemyGroupDef;
  regionId: RegionId;
}

interface CreatureSpawn {
  group: EnemyGroupDef;
  regionId: RegionId;
  regionLabel: string;
  place: PlaceRecord;
}

function allPlaces(): PlaceRecord[] {
  const places: PlaceRecord[] = [];
  for (const region of REGIONS) {
    for (const location of region.locations) {
      places.push({ location, regionId: region.id, regionLabel: region.name, tier: region.tier });
    }
    for (const location of region.dungeon?.locations ?? []) {
      places.push({
        location,
        regionId: region.dungeon!.id,
        regionLabel: region.dungeon!.name,
        tier: region.dungeon!.tier,
      });
    }
  }
  return places;
}

function worldMapFigure(
  points: readonly MapPoint[],
  options: { className?: string; ariaLabel: string; caption: string; assetBase: string },
): string {
  const bounds = WORLD_MAP_IMAGE_BOUNDS;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxZ - bounds.minZ;
  const markers = points.map((point) => {
    const x = ((point.position[0] - bounds.minX) / width) * 100;
    // The 4:3 source is contained inside a square viewport, leaving 12.5% above and below it.
    const y = 12.5 + ((bounds.maxZ - point.position[1]) / height) * 75;
    const label = `${point.label}, ${point.context}`;
    return [
      `<a class="corealm-map-marker" href="${escapeHtml(point.href)}"`,
      ` style="--map-x:${x.toFixed(4)}%;--map-y:${y.toFixed(4)}%"`,
      ` data-map-side="${x > 62 ? "left" : "right"}" data-map-kind="${escapeHtml(point.kind)}" data-map-marker`,
      ` aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">`,
      `<span>${escapeHtml(point.label)}<small>${escapeHtml(point.context)}</small></span></a>`,
    ].join("");
  }).join("\n");

  return [
    `<figure class="corealm-location-map${options.className ? ` ${options.className}` : ""}" data-location-map style="--map-image-ratio:${width / height}">`,
    `<div class="corealm-map-viewport" data-map-viewport role="region" tabindex="0" aria-label="${escapeHtml(options.ariaLabel)}">`,
    `<div class="corealm-map-stage" data-map-stage>`,
    `<img src="${docsWorldMapUrl(options.assetBase)}" alt="Overhead map rendered from the Corealm game world" draggable="false" />`,
    markers,
    `</div>`,
    `<span class="corealm-map-north" aria-hidden="true">N</span>`,
    `<div class="corealm-map-controls corealm-map-controls-zoom" aria-label="Map zoom controls">`,
    `<button type="button" data-map-action="out" aria-label="Zoom out" title="Zoom out">&minus;</button>`,
    `<button type="button" data-map-action="reset" aria-label="Reset map" title="Reset map">&#x25CE;</button>`,
    `<button type="button" data-map-action="in" aria-label="Zoom in" title="Zoom in">+</button>`,
    `</div>`,
    `<button class="corealm-map-expand" type="button" data-map-action="expand" aria-label="Expand map" aria-pressed="false" title="Expand map">&#x26F6;</button>`,
    `</div>`,
    `<figcaption>${escapeHtml(options.caption)}</figcaption>`,
    `</figure>`,
  ].join("\n");
}

/** Keep generated Markdown stable when the map image changes. */
export function docsWorldMapUrl(assetBase: string): string {
  return `${assetBase}world-map.webp`;
}

function locationMap(): string {
  const points = REGIONS.flatMap((region) => region.locations.map((location): MapPoint => ({
    id: location.id,
    label: location.name,
    context: region.name,
    kind: location.kind,
    position: location.position,
    href: `#${headingSlug(location.name)}`,
  })));
  return worldMapFigure(points, {
    ariaLabel: "Interactive map of Corealm locations",
    caption: "Drag to pan. Scroll or use + and - to zoom. The Gravelmaw rooms lie below its entrance marker.",
    assetBase: "../assets/",
  });
}

function placeById(id: string): PlaceRecord | undefined {
  return allPlaces().find(({ location }) => location.id === id);
}

function pointFromRecord(record: Record<string, unknown>): readonly [number, number] | undefined {
  const value = Array.isArray(record.position)
    ? record.position
    : Array.isArray(record.centre)
      ? record.centre
      : undefined;
  if (!value || value.length < 2 || typeof value[0] !== "number" || typeof value[1] !== "number") {
    return undefined;
  }
  return [value[0], value[1]];
}

function findAuthoredRecord(
  value: unknown,
  id: string,
  seen = new Set<object>(),
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findAuthoredRecord(child, id, seen);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.id === id && pointFromRecord(record)) return record;
  for (const child of Object.values(record)) {
    const found = findAuthoredRecord(child, id, seen);
    if (found) return found;
  }
  return undefined;
}

function authoredEntityPoint(id: string): AuthoredEntityPoint | undefined {
  for (const region of REGIONS) {
    const surface = findAuthoredRecord({
      settlement: region.settlement,
      obstacles: region.obstacles,
      landmarks: region.landmarks,
      gates: region.gates,
    }, id);
    const surfacePosition = surface && pointFromRecord(surface);
    if (surface && surfacePosition) {
      return {
        id,
        name: typeof surface.name === "string" ? surface.name : humanizeId(id),
        position: surfacePosition,
        regionId: region.id,
      };
    }
    const dungeon = region.dungeon && findAuthoredRecord(region.dungeon, id);
    const dungeonPosition = dungeon && pointFromRecord(dungeon);
    if (dungeon && dungeonPosition && region.dungeon) {
      return {
        id,
        name: typeof dungeon.name === "string" ? dungeon.name : humanizeId(id),
        position: dungeonPosition,
        regionId: region.dungeon.id,
      };
    }
  }
  return undefined;
}

function stagePlaces(stage: QuestStageDef): PlaceRecord[] {
  const refs = (stage.refs ?? []).filter((ref) => ref.kind === "location");
  if (refs.length === 0) {
    throw new Error(`Quest stage ${stage.index + 1} has no authored location reference.`);
  }
  return refs.map((ref) => {
    const place = placeById(ref.id);
    if (!place) throw new Error(`Quest stage ${stage.index + 1} references unknown location ${ref.id}.`);
    return place;
  });
}

function enemyGroupForStage(
  quest: QuestDef,
  stage: QuestStageDef,
  family: string,
): ResolvedEnemyGroup | undefined {
  const places = stagePlaces(stage);
  if (places.some((place) => place.regionId === "gravelmaw")) {
    for (const region of REGIONS) {
      const group = region.dungeon?.enemyGroups.find((candidate) => candidate.family === family);
      if (group && region.dungeon) return { group, regionId: region.dungeon.id };
    }
  }

  // A quest may send the player back to an earlier region. Resolve the enemy from the stage's
  // authored locations first, then use the quest region as a fallback. The Sparking Stone is based
  // in Karrowmoor but names Rill Skitterlings in Fallowmarch, so quest.regionId alone picks the
  // tier-10 Scree group and teaches the wrong route.
  const candidateRegionIds = [
    ...new Set([
      ...places.map((place) => place.regionId).filter((id) => id !== "gravelmaw"),
      quest.regionId,
    ]),
  ];
  for (const regionId of candidateRegionIds) {
    const region = REGIONS.find((candidate) => candidate.id === regionId);
    const group = region?.enemyGroups.find((candidate) => candidate.family === family);
    if (group && region) return { group, regionId: region.id };
  }
  return undefined;
}

function enemyGroupById(id: string): ResolvedEnemyGroup | undefined {
  for (const region of REGIONS) {
    const surface = region.enemyGroups.find((group) => group.id === id);
    if (surface) return { group: surface, regionId: region.id };
    const dungeon = region.dungeon?.enemyGroups.find((group) => group.id === id);
    if (dungeon && region.dungeon) return { group: dungeon, regionId: region.dungeon.id };
  }
  return undefined;
}

function distanceBetween(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function nearestPlace(regionId: RegionId, position: readonly [number, number]): PlaceRecord {
  const places = allPlaces().filter((place) => place.regionId === regionId);
  const nearest = [...places].sort((a, b) =>
    distanceBetween(a.location.position, position) - distanceBetween(b.location.position, position))[0];
  if (!nearest) throw new Error(`No authored place exists in ${regionId}.`);
  return nearest;
}

function creatureForGroup(group: EnemyGroupDef): EnemyDef {
  const creature = ENEMY_BLOCKS.find((candidate) =>
    candidate.family === group.family && candidate.tier === group.tier);
  if (!creature) throw new Error(`No creature stat block resolves for enemy group ${group.id}.`);
  return creature;
}

function creatureSpawns(creature: EnemyDef): CreatureSpawn[] {
  const spawns: CreatureSpawn[] = [];
  for (const region of REGIONS) {
    for (const group of region.enemyGroups) {
      if (group.family !== creature.family || group.tier !== creature.tier) continue;
      spawns.push({
        group,
        regionId: region.id,
        regionLabel: region.name,
        place: nearestPlace(region.id, group.centre),
      });
    }
    for (const group of region.dungeon?.enemyGroups ?? []) {
      if (group.family !== creature.family || group.tier !== creature.tier || !region.dungeon) continue;
      spawns.push({
        group,
        regionId: region.dungeon.id,
        regionLabel: region.dungeon.name,
        place: nearestPlace(region.dungeon.id, group.centre),
      });
    }
  }
  if (spawns.length === 0) throw new Error(`No authored spawn group resolves for creature ${creature.id}.`);
  return spawns;
}

function questStepMap(quest: QuestDef, stage: QuestStageDef): string {
  const places = stagePlaces(stage);
  const subjectPoints: MapPoint[] = [];
  for (const ref of stage.refs ?? []) {
    if (ref.kind === "entity") {
      const point = authoredEntityPoint(ref.id);
      const person = npc(ref.id);
      const enemyGroup = enemyGroupById(ref.id);
      const position = point?.position ?? enemyGroup?.group.centre;
      const regionId = point?.regionId ?? enemyGroup?.regionId;
      if (!position || !regionId || regionId === "gravelmaw") continue;
      subjectPoints.push({
        id: ref.id,
        label: person?.name ?? enemyGroup?.group.name ?? point?.name ?? humanizeId(ref.id),
        context: regionName(regionId),
        kind: person ? "npc" : enemyGroup ? "enemy" : "entity",
        position,
        href: person
          ? `../../npcs/#${headingSlug(person.name)}`
          : enemyGroup
            ? `../../creatures/${creatureForGroup(enemyGroup.group).id}/`
            : point
              ? `../../regions/#${headingSlug(nearestPlace(point.regionId, point.position).location.name)}`
              : `../../regions/#${headingSlug(places[0]!.location.name)}`,
      });
    }
    if (ref.kind === "enemyFamily") {
      const resolved = enemyGroupForStage(quest, stage, ref.id);
      if (!resolved || resolved.regionId === "gravelmaw") continue;
      const creature = creatureForGroup(resolved.group);
      subjectPoints.push({
        id: resolved.group.id,
        label: resolved.group.name,
        context: regionName(resolved.regionId),
        kind: "enemy",
        position: resolved.group.centre,
        href: `../../creatures/${creature.id}/`,
      });
    }
  }

  const locationPoints: MapPoint[] = places
    .filter((place) => place.regionId !== "gravelmaw")
    .map((place) => ({
      id: place.location.id,
      label: place.location.name,
      context: place.regionLabel,
      kind: place.location.kind,
      position: place.location.position,
      href: `../../regions/#${headingSlug(place.location.name)}`,
    }));
  const distantLocations = locationPoints.filter((location) =>
    !subjectPoints.some((subject) => distanceBetween(subject.position, location.position) < 24));
  const points = [...subjectPoints, ...distantLocations];

  const dungeonPlaces = places.filter((place) => place.regionId === "gravelmaw");
  if (dungeonPlaces.length > 0) {
    const entrance = placeById("gravelmaw_entrance");
    if (!entrance) throw new Error("The Gravelmaw entrance is missing from the authored locations.");
    points.push({
      id: "gravelmaw-access",
      label: "The Gravelmaw",
      context: `Entrance to ${dungeonPlaces.map((place) => place.location.name).join(", ")}`,
      kind: "dungeon",
      position: entrance.location.position,
      href: `../../regions/#${headingSlug(dungeonPlaces.at(-1)!.location.name)}`,
    });
  }

  const unique = [...new Map(points.map((point) => [`${point.id}:${point.href}`, point])).values()];
  const names = places.map((place) => place.location.name).join(", ");
  const dungeonNote = dungeonPlaces.length > 0 ? " Dungeon rooms are reached through The Gravelmaw entrance." : "";
  return worldMapFigure(unique, {
    className: "corealm-quest-map",
    ariaLabel: `Map for ${quest.name}, step ${stage.index + 1}`,
    caption: `${names}.${dungeonNote}`,
    assetBase: "../../assets/",
  });
}

interface QuestScene {
  key: string;
  kind: CaptureKind;
  id: string;
  label: string;
  context: string;
}

function questStepScenes(quest: QuestDef, stage: QuestStageDef): QuestScene[] {
  const scenes: QuestScene[] = [];
  for (const ref of stage.refs ?? []) {
    if (ref.kind === "entity") {
      const person = npc(ref.id);
      const point = authoredEntityPoint(ref.id);
      const enemyGroup = enemyGroupById(ref.id);
      if (enemyGroup) {
        scenes.push({
          key: `enemyGroup:${enemyGroup.group.id}`,
          kind: "enemyGroup",
          id: enemyGroup.group.id,
          label: enemyGroup.group.name,
          context: `${nearestPlace(enemyGroup.regionId, enemyGroup.group.centre).location.name}, ${regionName(enemyGroup.regionId)}`,
        });
        continue;
      }
      scenes.push({
        key: `entity:${ref.id}`,
        kind: person ? "npc" : "entity",
        id: ref.id,
        label: person?.name ?? point?.name ?? humanizeId(ref.id),
        context: point
          ? `${nearestPlace(point.regionId, point.position).location.name}, ${regionName(point.regionId)}`
          : stagePlaces(stage).map((place) => place.location.name).join(", "),
      });
    }
    if (ref.kind === "enemyFamily") {
      const resolved = enemyGroupForStage(quest, stage, ref.id);
      if (!resolved) throw new Error(`No ${ref.id} group resolves for ${quest.id} stage ${stage.index + 1}.`);
      scenes.push({
        key: `enemyGroup:${resolved.group.id}`,
        kind: "enemyGroup",
        id: resolved.group.id,
        label: resolved.group.name,
        context: `${nearestPlace(resolved.regionId, resolved.group.centre).location.name}, ${regionName(resolved.regionId)}`,
      });
    }
  }
  if (scenes.length === 0) {
    for (const place of stagePlaces(stage)) {
      scenes.push({
        key: `location:${place.location.id}`,
        kind: "location",
        id: place.location.id,
        label: place.location.name,
        context: `${place.location.name}, ${place.regionLabel}`,
      });
    }
  }
  return [...new Map(scenes.map((scene) => [scene.key, scene])).values()];
}

function questStepEvidence(quest: QuestDef, stage: QuestStageDef): string {
  const places = stagePlaces(stage);
  const whereLinks = places.map((place) =>
    `<a href="../../regions/#${headingSlug(place.location.name)}">${escapeHtml(place.location.name)}</a>`).join("");
  const itemLinks = (stage.refs ?? [])
    .filter((ref) => ref.kind === "item")
    .map((ref) => `<a href="../../items/${escapeHtml(ref.id)}/">${escapeHtml(itemName(ref.id))}</a>`)
    .join("");
  const where = `<nav class="corealm-quest-where" aria-label="Locations for step ${stage.index + 1}"><span>Where</span>${whereLinks}</nav>`;
  const items = itemLinks
    ? `<nav class="corealm-quest-items" aria-label="Items for step ${stage.index + 1}"><span>Items</span>${itemLinks}</nav>`
    : "";
  const scenes = questStepScenes(quest, stage).map((scene) => [
    `<figure class="corealm-quest-scene">`,
    `<img src="${publicCaptureAsset(scene.kind, scene.id, "../../")}" alt="${escapeHtml(`${scene.label} in the running Corealm world`)}" loading="lazy" />`,
    `<figcaption><strong>${escapeHtml(scene.label)}</strong><span>${escapeHtml(scene.context)}</span></figcaption>`,
    `</figure>`,
  ].join("")).join("\n");
  return [
    where,
    items,
    `<div class="corealm-quest-step-evidence">`,
    `<div class="corealm-quest-scenes">${scenes}</div>`,
    questStepMap(quest, stage),
    `</div>`,
  ].filter(Boolean).join("\n");
}

function xpDoc(): string {
  const levels = xpTable();
  const rows = levels
    .map((xp, level) => [level, xp.toLocaleString(), level > 1 ? (xp - levels[level - 1]!).toLocaleString() : "-"])
    .filter((row) => Number(row[0]) >= 1);
  return page("Experience table", "The complete Corealm experience curve.", [
    `Skills run from level 1 to ${MAX_LEVEL}. Level ${MAX_LEVEL} requires **${totalXpAt(MAX_LEVEL).toLocaleString()} XP**.`,
    "",
    `Content tiers unlock at levels ${TIERS.join(", ")}.`,
    "",
    table(["Level", "Total XP", "XP from previous level"], rows),
  ].join("\n"));
}

const GATHERING_PRODUCTION_SKILLS = [
  "mining", "smithing", "fishing", "cooking", "woodcutting", "fletching", "crafting",
] as const satisfies readonly SkillId[];

function gatheringUnlocks(definition: GatheringProductionTier, skill: SkillId): string[] {
  const resourceIds = skill === "mining"
    ? definition.resources.mining
    : skill === "fishing"
      ? [definition.resources.fishing]
      : skill === "woodcutting"
        ? [definition.resources.woodcutting]
        : [];
  return resourceIds.map((id) => {
    const resource = resourceForGuide(id);
    const bonus = resource.bonus?.length
      ? `, plus ${resource.bonus.map((drop) => itemName(drop.itemId)).join(" or ")}`
      : "";
    return `${resource.name} yields ${itemName(resource.itemId)}${bonus}`;
  });
}

function productionUnlocks(definition: GatheringProductionTier, skill: SkillId): string[] {
  return recipesAtTier(definition.tier, skill).map((recipe) => recipeResult(recipe));
}

function generatedSkillGuides(): string {
  return GATHERING_PRODUCTION_SKILLS.map((skill) => {
    const rows = GATHERING_PRODUCTION_TIERS.map((definition) => {
      const unlocks = gatheringUnlocks(definition, skill);
      if (unlocks.length === 0) unlocks.push(...productionUnlocks(definition, skill));
      return [definition.reqLevel, unlocks.join(", ")];
    });
    return `### ${skillName(skill)}\n\n${table(["Level", "Unlocks"], rows)}`;
  }).join("\n\n");
}

function skillsDoc(): string {
  const groups: Record<string, string[]> = {};
  for (const skill of Object.values(SKILLS)) {
    (groups[skill.group] ??= []).push(`- **${skill.name}:** ${skill.blurb}`);
  }
  const sections = Object.entries(groups)
    .map(([group, lines]) => `## ${group[0]!.toUpperCase()}${group.slice(1)}\n\n${lines.join("\n")}`)
    .join("\n\n");
  const gatherRows = GATHERING_PRODUCTION_TIERS.map((definition) => {
    const [low, high] = yieldRange(definition.tier);
    return [
      definition.reqLevel,
      gatherXp(definition.tier),
      `${low}-${high}`,
      `${respawnSeconds(definition.tier)} s`,
      `+${toolBonus(definition.tier)}`,
    ];
  });
  return page("Skills", "Corealm skills, gathering rules, and combat rules.", [
    sections,
    "",
    "## Gathering",
    "",
    "Mining, Woodcutting, and Fishing attempt an action every **1.8 seconds**. Success starts at 30% at the required level, rises by 1.6 percentage points per extra level, and caps at 95%.",
    "",
    table(["Level", "XP per yield", "Yields per node", "Respawn", "Tool bonus"], gatherRows),
    "",
    "## Gathering and production skill guides",
    "",
    "The unlock rows below come from the same tier, resource, recipe, and item tables used by the game. See the [three complete gathering loops](../gathering-production/) for ingredients and finished equipment.",
    "",
    generatedSkillGuides(),
    "",
    "## Combat",
    "",
    "Melee attacks resolve on a 600 ms combat tick. Magic launches and bolt arrivals resolve on the 100 ms simulation tick, so wands keep their exact 2.2 second cadence and staffs keep their exact 3.0 second cadence. Melee supplies physical defence; Magic supplies magical defence. Health is `20 + 3 × floor((Melee + Magic) / 2)` plus equipment vitality. Magic is 15% more accurate. Each cast spends one matching elemental-weapon charge first, then one carried Essence.",
  ].join("\n"));
}

function sortedGuideItems(): typeof ALL_ITEMS[number][] {
  return [...ALL_ITEMS]
    .sort((a, b) => a.tier - b.tier || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function tooltipHtml(item: typeof ALL_ITEMS[number]): string {
  const model = itemTooltipContent(item.id);
  const stats = item.equip
    ? `<span class="tooltip__stats">${model.stats.map((stat) => (
      `<span>${escapeHtml(stat.label)}</span><span class="tooltip__stat-value u-numeric">${stat.value > 0 ? "+" : ""}${stat.value}</span>`
    )).join("") || `<span class="u-faint">No stat bonuses</span>`}</span>`
    : "";
  const details = model.details.map((detail) => {
    const unreleased = detail === "This orb is not released.";
    return `<span class="${unreleased ? "tooltip__requirement is-unmet" : "tooltip__body"}">${escapeHtml(detail)}</span>`;
  }).join("");
  const requirements = model.requirements.map((requirement) =>
    `<span class="tooltip__requirement">${escapeHtml(requirement.text)}</span>`).join("");
  return [
    `<span class="tooltip" id="item-tooltip-${escapeHtml(item.id)}" role="tooltip">`,
    `<span class="tooltip__title">${escapeHtml(model.title)}</span>`,
    `<span class="tooltip__tier">${escapeHtml(model.meta ?? "")}</span>`,
    model.description ? `<span class="tooltip__body">${escapeHtml(model.description)}</span>` : "",
    stats,
    details,
    requirements,
    model.value ? `<span class="tooltip__body u-numeric">${escapeHtml(model.value)}</span>` : "",
    `</span>`,
  ].join("");
}

function itemGalleryTile(item: typeof ALL_ITEMS[number]): string {
  const released = itemIsReleased(item);
  return [
    `<a class="corealm-item-tile${released ? "" : " is-unreleased"}"`,
    ` id="${headingSlug(item.name)}" data-item-id="${escapeHtml(item.id)}"`,
    ` href="./${escapeHtml(item.id)}/" aria-label="${escapeHtml(item.name)}"`,
    ` aria-describedby="item-tooltip-${escapeHtml(item.id)}">`,
    `<img src="../assets/items/${escapeHtml(item.id)}.png" alt="" width="256" height="256" loading="lazy" />`,
    `<span class="corealm-item-tile__name">${escapeHtml(item.name)}</span>`,
    `<span class="corealm-item-tile__meta">Tier ${item.tier} · ${escapeHtml(item.category)}</span>`,
    released ? "" : `<span class="corealm-item-tile__status">Unreleased</span>`,
    tooltipHtml(item),
    `</a>`,
  ].join("");
}

export function itemsDoc(): string {
  const groups = new Map<number, typeof ALL_ITEMS[number][]>();
  for (const item of sortedGuideItems()) {
    const group = groups.get(item.tier) ?? [];
    group.push(item);
    groups.set(item.tier, group);
  }
  const sections = [...groups].map(([tier, items]) => [
    `## Tier ${tier}`,
    "",
    `<div class="corealm-item-gallery" data-item-gallery>`,
    ...items.map(itemGalleryTile),
    `</div>`,
  ].join("\n"));
  return page("Items", "Browse every item in Corealm and open its source-backed reference page.", [
    `${ALL_ITEMS.length} items from the live game catalog. Hover an icon or focus it with the keyboard for the in-game item card.`,
    "",
    ...sections,
  ].join("\n\n"));
}

function itemQuestLinks(itemId: string): string[] {
  return QUESTS.filter((quest) => {
    const encoded = JSON.stringify(quest);
    return encoded.includes(`\"itemId\":\"${itemId}\"`)
      || encoded.includes(`\"kind\":\"item\",\"id\":\"${itemId}\"`);
  }).map((quest) => `[${quest.name}](../../quests/${quest.id}/)`);
}

export function itemDetailDoc(item: typeof ALL_ITEMS[number]): string {
  const model = itemTooltipContent(item.id);
  const producedBy = RECIPES.filter((recipe) => recipe.output.itemId === item.id);
  const usedBy = RECIPES.filter((recipe) => recipe.inputs.some((input) => input.itemId === item.id));
  const gatheredFrom = RESOURCE_ARCHETYPES.filter((resource) =>
    resource.itemId === item.id || resource.bonus?.some((drop) => drop.itemId === item.id));
  const droppedBy = new Map<string, { enemy: EnemyDef; drop: EnemyDef["drops"][number]; linked: boolean }>();
  for (const enemy of ENEMIES.filter((candidate) => candidate.drops.some((drop) => drop.itemId === item.id))) {
    const canonical = guideCreatures().find((candidate) =>
      candidate.family === enemy.family && candidate.tier === enemy.tier);
    const key = `${enemy.family}:${enemy.tier}`;
    if (!droppedBy.has(key)) {
      droppedBy.set(key, {
        enemy: canonical ?? enemy,
        drop: enemy.drops.find((drop) => drop.itemId === item.id)!,
        linked: canonical !== undefined,
      });
    }
  }
  const soldBy = SHOPS.filter((shop) => shop.stock.some((stock) => stock.itemId === item.id));
  const quests = itemQuestLinks(item.id);

  const facts: (string | number)[][] = [
    ["Tier", item.tier], ["Category", item.category], ["Stacks", item.stackable ? "Yes" : "No"],
    ["Buy value", item.value.toLocaleString("en-US")], ["Sell value", sellPrice(item.value).toLocaleString("en-US")],
  ];
  if (item.equip) facts.push(["Equipment slot", item.equip.slot.replace(/([A-Z])/g, " $1").trim()]);
  if (!model.released) facts.push(["Availability", "Unreleased"]);

  const sections: string[] = [
    `<div class="corealm-item-detail${model.released ? "" : " is-unreleased"}">`,
    `<img src="../../assets/items/${escapeHtml(item.id)}.png" alt="${escapeHtml(item.name)}" width="256" height="256" />`,
    `<p>${escapeHtml(item.description)}</p>`,
    `</div>`,
    "",
    table(["Fact", "Value"], facts),
  ];
  if (model.stats.length) {
    sections.push("", "## Equipment stats", "", table(
      ["Stat", "Bonus"],
      model.stats.map((stat) => [stat.label, stat.value > 0 ? `+${stat.value}` : stat.value]),
    ));
  }
  const behavior = [...model.details, ...model.requirements.map((entry) => entry.text)];
  if (behavior.length) sections.push("", "## Use and requirements", "", ...behavior.map((line) => `- ${line}`));

  const sourceRows: (string | number)[][] = [];
  for (const recipe of producedBy) sourceRows.push(["Made by", recipe.name, `${recipe.output.quantity} per craft`]);
  for (const resource of gatheredFrom) {
    const secondary = resource.itemId !== item.id;
    const chance = resource.bonus?.find((drop) => drop.itemId === item.id)?.chance;
    sourceRows.push([secondary ? "Bonus from" : "Gathered from", resource.name,
      secondary && chance !== undefined ? `${Math.round(chance * 1000) / 10}% per gather` : `${skillName(resource.skill)} level ${resource.reqLevel}`]);
  }
  for (const { enemy, drop, linked } of droppedBy.values()) {
    sourceRows.push(["Dropped by", linked ? `[${enemy.name}](../../creatures/${enemy.id}/)` : enemy.name,
      `${Math.round(drop.chance * 1000) / 10}% · ${drop.quantity[0]}-${drop.quantity[1]}`]);
  }
  for (const shop of soldBy) {
    const stock = shop.stock.find((entry) => entry.itemId === item.id)!;
    sourceRows.push(["Sold by", `[${shop.name}](../../spells-and-shops/#${headingSlug(shop.name)})`,
      `${stock.quantity.toLocaleString("en-US")} in stock`]);
  }
  for (const quest of quests) sourceRows.push(["Quest", quest, "Referenced, granted, or required"]);
  if (sourceRows.length) sections.push("", "## Where it comes from", "", table(["Source", "Name", "Details"], sourceRows));

  if (usedBy.length) sections.push("", "## Used to make", "", ...usedBy.map((recipe) => {
    const input = recipe.inputs.find((entry) => entry.itemId === item.id)!;
    return `- ${input.quantity}× for **${recipe.name}**, producing ${recipe.output.quantity}× ${itemLink(recipe.output.itemId, itemName(recipe.output.itemId), "../../")}`;
  }));
  sections.push("", "[Back to all items](../)");
  return page(item.name, item.description, sections.join("\n"));
}

function recipesDoc(): string {
  const bySkill = new Map<SkillId, typeof RECIPES[number][]>();
  for (const recipe of RECIPES) {
    const list = bySkill.get(recipe.skill) ?? [];
    list.push(recipe);
    bySkill.set(recipe.skill, list);
  }
  const sections = [...bySkill.entries()].map(([skill, recipes]) => {
    const rows = [...recipes].sort((a, b) => a.reqLevel - b.reqLevel).map((recipe) => [
      recipe.name,
      recipe.reqLevel,
      recipe.stations?.join(" / ") ?? "Anywhere",
      recipe.inputs.map((input) => `${input.quantity}× ${itemName(input.itemId)}`).join(" + "),
      `${recipe.output.quantity}× ${itemName(recipe.output.itemId)}`,
      `${(recipe.durationMs / 1000).toFixed(1)} s`,
      recipe.xp,
    ]);
    return `## ${skillName(skill)}\n\n${table(["Recipe", "Level", "Station", "Ingredients", "Makes", "Time", "XP"], rows)}`;
  });
  return page("Recipes", "Production recipes generated from the live game tables.", sections.join("\n\n"));
}

function miningAndSmithingGuide(): string {
  const gatheringRows = GATHERING_PRODUCTION_TIERS.flatMap((definition) =>
    definition.resources.mining.map((resourceId) => {
      const resource = resourceForGuide(resourceId);
      const [low, high] = yieldRange(resource.tier);
      const secondary = resource.bonus?.map((drop) =>
        `${itemLink(drop.itemId)} at ${Math.round(drop.chance * 1_000) / 10}%`).join(", ") ?? "-";
      return [
        definition.reqLevel,
        resource.name,
        itemLink(resource.itemId),
        secondary,
        gatherXp(resource.tier),
        `${low}-${high}`,
        `${respawnSeconds(resource.tier)} s`,
      ];
    }));

  const smithingRows = GATHERING_PRODUCTION_TIERS.map((definition) => {
    const barRecipe = recipeForOutput(definition, definition.items.bar);
    const finished = recipesAtTier(definition.tier, "smithing")
      .filter((recipe) => recipe.kind === "smith")
      .map((recipe) => itemLink(recipe.output.itemId))
      .join(", ");
    return [
      definition.reqLevel,
      `${recipeIngredients(barRecipe)} → ${recipeResult(barRecipe)}`,
      recipeStations(barRecipe),
      `${(barRecipe.durationMs / 1_000).toFixed(1)} s`,
      barRecipe.xp,
      finished,
    ];
  });

  return [
    "## 1. Mining and Smithing",
    "",
    "March Stone remains the flux for every bar. This keeps the level 1 mine useful after later metal tiers unlock.",
    "",
    "### Mining unlocks",
    "",
    table(["Level", "Node", "Primary yield", "Secondary yield", "XP", "Per node", "Respawn"], gatheringRows),
    "",
    "### Smithing unlocks",
    "",
    table(["Level", "Bar recipe", "Station", "Time", "XP", "Finished equipment"], smithingRows),
  ].join("\n");
}

function fishingAndCookingGuide(): string {
  const rows = GATHERING_PRODUCTION_TIERS.map((definition) => {
    const resource = resourceForGuide(definition.resources.fishing);
    const recipe = recipeForOutput(definition, definition.items.cookedFish);
    const cooked = itemForGuide(definition.items.cookedFish);
    if (!cooked.food) throw new Error(`${cooked.id} is the cooked fish for tier ${definition.tier} but has no food data.`);
    return [
      definition.reqLevel,
      resource.name,
      itemLink(definition.items.rawFish),
      itemLink(definition.items.cookedFish),
      cooked.food.healAmount,
      recipe.xp,
      recipeStations(recipe),
      `${(recipe.durationMs / 1_000).toFixed(1)} s`,
      `${Math.round(burnChance(definition.reqLevel, recipe.reqLevel) * 100)}%`,
      itemLink(definition.items.burntFish),
    ];
  });

  return [
    "## 2. Fishing and Cooking",
    "",
    "A range and a player-built campfire use the same recipe and burn chance. Raw and burnt fish are not food.",
    "",
    table(
      ["Level", "Fishing spot", "Raw fish", "Cooked food", "Heal", "Cooking XP", "Stations", "Time", "Burn at unlock", "Burnt result"],
      rows,
    ),
    "",
    "Burn chance is `clamp(0.45 - 0.030 × (Cooking level - recipe level), 0, 0.45)`. Cooked fish takes 1.8 seconds to eat and cannot heal above maximum health.",
  ].join("\n");
}

function woodcuttingFletchingCraftingGuide(): string {
  const rows = GATHERING_PRODUCTION_TIERS.map((definition) => {
    const resource = resourceForGuide(definition.resources.woodcutting);
    const shaft = recipeForOutput(definition, definition.items.shaft);
    const handle = recipeForOutput(definition, definition.items.handle);
    const woodenEquipment = recipesAtTier(definition.tier, "fletching")
      .filter((recipe) => recipe.output.itemId !== definition.items.shaft && recipe.output.itemId !== definition.items.handle)
      .map((recipe) => `${itemLink(recipe.output.itemId)} from ${recipeIngredients(recipe)}`)
      .join("; ");
    return [
      definition.reqLevel,
      resource.name,
      itemLink(definition.items.log),
      `${recipeIngredients(shaft)} → ${recipeResult(shaft)} for ${shaft.xp} XP`,
      `${recipeIngredients(handle)} → ${recipeResult(handle)} for ${handle.xp} XP`,
      woodenEquipment,
    ];
  });

  const craftingRows = GATHERING_PRODUCTION_TIERS.map((definition) => [
    definition.reqLevel,
    itemLink(definition.items.gem),
    recipesAtTier(definition.tier, "crafting")
      .map((recipe) => `${itemLink(recipe.output.itemId)} from ${recipeIngredients(recipe)}`)
      .join("; "),
  ]);

  return [
    "## 3. Woodcutting, Fletching, and Crafting",
    "",
    "Each log tier supplies the reusable shafts and handles used by wooden gear and handled metal equipment.",
    "",
    "### Wood and Fletching unlocks",
    "",
    table(["Level", "Tree", "Log", "Shafts", "Handles", "Wooden equipment"], rows),
    "",
    "### Mining and Crafting bridge",
    "",
    table(["Level", "Gem", "Crafting outputs"], craftingRows),
    "",
    "[Campfire fuel, lifetime, and build XP](../campfires/) also derive from each tier's log row.",
  ].join("\n");
}

function gatheringProductionDoc(): string {
  return page(
    "Gathering and production",
    "The level 1, 5, and 10 gathering loops, generated from the live tier, resource, item, and recipe tables.",
    [
      "These tables are a content check as much as a player guide. A tier appears here only when the canonical catalog resolves its resources, items, and recipes.",
      "",
      miningAndSmithingGuide(),
      "",
      fishingAndCookingGuide(),
      "",
      woodcuttingFletchingCraftingGuide(),
    ].join("\n"),
  );
}

function campfiresDoc(): string {
  const rows = GATHERING_PRODUCTION_TIERS.map((definition) => {
    const fuel = definition.campfire;
    return [
      definition.reqLevel,
      itemLink(fuel.logItemId),
      `${(fuel.buildTimeMs / 1_000).toFixed(1)} s`,
      `${fuel.lifetimeMs / 1_000} s`,
      fuel.buildXp.fletching,
      fuel.buildXp.crafting,
      fuel.visualLogAssetId,
    ];
  });
  const cookingRecipes = GATHERING_PRODUCTION_TIERS.map((definition) =>
    recipeForOutput(definition, definition.items.cookedFish));
  const incompatible = cookingRecipes.filter((recipe) => !recipe.stations?.includes("campfire"));
  if (incompatible.length > 0) {
    throw new Error(`Cooking recipes missing campfire compatibility: ${incompatible.map((recipe) => recipe.id).join(", ")}`);
  }
  return page("Campfires", "Campfire fuels, lifetimes, build XP, and cooking compatibility from the live content tables.", [
    "Building a fire consumes one log when the three-second build completes. A successful new fire replaces the old one. Log tier changes lifetime and build XP only.",
    "",
    table(["Level", "Log", "Build time", "Lifetime", "Fletching XP", "Crafting XP", "Log asset"], rows),
    "",
    "Lifetime follows `60 + 12 × tier` seconds. Each skill receives `round(gatherXp(tier) × 0.2)` XP.",
    "",
    `All ${cookingRecipes.length} fish recipes accept both Range and Campfire. If a fire expires during a batch, completed food stays in the inventory and the next fish is not consumed.`,
  ].join("\n"));
}

function creatureSpawnMap(creature: EnemyDef, spawns: readonly CreatureSpawn[]): string {
  const entrance = placeById("gravelmaw_entrance");
  const points = spawns.map((spawn): MapPoint => {
    const insideDungeon = spawn.regionId === "gravelmaw";
    if (insideDungeon && !entrance) throw new Error("The Gravelmaw entrance is missing from the authored locations.");
    return {
      id: spawn.group.id,
      label: spawn.group.name,
      context: insideDungeon
        ? `${spawn.regionLabel}, ${spawn.place.location.name}`
        : `${spawn.place.location.name}, ${spawn.regionLabel}`,
      kind: insideDungeon ? "dungeon" : "enemy",
      position: insideDungeon ? entrance!.location.position : spawn.group.centre,
      href: `../../regions/#${headingSlug(spawn.place.location.name)}`,
    };
  });
  const hasDungeonSpawn = spawns.some((spawn) => spawn.regionId === "gravelmaw");
  return worldMapFigure(points, {
    className: "corealm-creature-map",
    ariaLabel: `Spawn map for ${creature.name}`,
    caption: hasDungeonSpawn
      ? "Outdoor markers use the exact spawn centre. Gravelmaw markers use the dungeon entrance; the room is listed beside each capture."
      : "Markers use each authored spawn group's exact centre.",
    assetBase: "../../assets/",
  });
}

function creatureIndexDoc(): string {
  const rows = guideCreatures()
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name))
    .map((creature) => {
      const spawns = creatureSpawns(creature);
      const regions = [...new Map(spawns.map((spawn) => [spawn.regionId, spawn.regionLabel])).values()].join(", ");
      return [`[${creature.name}](./${creature.id}/)`, creature.tier, regions];
    });
  return page("Creatures", "Every creature in Corealm, with a separate spawn, stats, and drops page.", table(
    ["Creature", "Tier", "Regions"],
    rows,
  ));
}

/** Candidate stat blocks without authored spawns have no public location page yet. */
export function guideCreatures(): EnemyDef[] {
  const groups = REGIONS.flatMap((region) => [...region.enemyGroups, ...region.dungeon?.enemyGroups ?? []]);
  return ENEMY_BLOCKS.filter((creature) => groups.some((group) =>
    group.family === creature.family && group.tier === creature.tier));
}

function creatureDoc(creature: EnemyDef): string {
  const spawns = creatureSpawns(creature);
  const spawnRows = spawns.map((spawn) => [
    `[${spawn.regionLabel}](../../regions/#${headingSlug(spawn.place.location.name)})`,
    `[${spawn.place.location.name}](../../regions/#${headingSlug(spawn.place.location.name)})`,
    spawn.group.name,
    spawn.group.count,
  ]);
  const scenes = spawns.map((spawn) => [
    `<figure class="corealm-quest-scene">`,
    `<img src="${publicCaptureAsset("enemyGroup", spawn.group.id, "../../")}" alt="${escapeHtml(`${spawn.group.name} at its authored spawn in ${spawn.regionLabel}`)}" loading="lazy" />`,
    `<figcaption><strong>${escapeHtml(spawn.group.name)}</strong><span>${escapeHtml(`${spawn.place.location.name}, ${spawn.regionLabel}`)}</span></figcaption>`,
    `</figure>`,
  ].join("")).join("\n");
  const hasOrbDrop = creature.drops.some((drop) => content.item(drop.itemId)?.orb);
  const dropRows: (string | number)[][] = creature.drops.map((drop) => {
    const singletonOrb = Boolean(content.item(drop.itemId)?.orb);
    return [
      itemLink(drop.itemId, itemName(drop.itemId), "../../"),
      drop.quantity[0] === drop.quantity[1] ? drop.quantity[0] : `${drop.quantity[0]}-${drop.quantity[1]}`,
      singletonOrb
        ? (drop.chance === 1 ? "First eligible acquisition" : `${Math.round(drop.chance * 1000) / 10}% when eligible`)
        : `${Math.round(drop.chance * 1000) / 10}%`,
    ];
  });
  if (creature.marks) {
    dropRows.unshift([
      "Marks",
      creature.marks[0] === creature.marks[1] ? creature.marks[0] : `${creature.marks[0]}-${creature.marks[1]}`,
      "Always",
    ]);
  }
  return page(creature.name, `${creature.name} spawn locations, combat stats, and drops.`, [
    `<div class="corealm-creature-spawn-evidence">`,
    `<div class="corealm-quest-scenes">${scenes}</div>`,
    creatureSpawnMap(creature, spawns),
    `</div>`,
    "",
    "## Spawn locations",
    "",
    table(["Region", "Nearest place", "Spawn group", "Count"], spawnRows),
    "",
    "## Stats",
    "",
    table(["Tier", "Health", "Attack", "Defence", "Accuracy", "Max hit", "Attack speed", "Armour", "Magic armour", "Behaviour", "Aggro"], [[
      creature.tier,
      creature.maxHealth,
      creature.attackLevel,
      creature.defenceLevel,
      creature.accuracy,
      creature.maxHit,
      `${(creature.attackSpeedMs / 1000).toFixed(1)} s`,
      creature.armour,
      creature.magicArmour,
      creature.behaviour,
      `${creature.aggroRadius} m`,
    ]]),
    "",
    "## Drops",
    "",
    hasOrbDrop
      ? "Elemental orbs are singleton altar keys. The boss drops its orb when no physical copy exists. Repeat kills do not create a duplicate while that orb is carried, banked, or waiting in loot or recovery. If the copy is lost before awakening its altar, the boss can drop it again. Once consumed to awaken that altar, it never drops again."
      : "",
    "",
    table(["Drop", "Quantity", "Chance or rule"], dropRows),
  ].join("\n"));
}

function resourcesDoc(): string {
  const rows = [...RESOURCE_ARCHETYPES]
    .sort((a, b) => a.tier - b.tier || a.skill.localeCompare(b.skill))
    .map((resource) => {
      const lifecycle = resourceGuideLifecycle(resource.id);
      const secondary = resource.bonus?.map((drop) =>
        `${itemLink(drop.itemId)} ${Math.round(drop.chance * 1_000) / 10}%`).join(", ") ?? "-";
      const size = resource.presentation.waterOffset === undefined
        ? `${resource.presentation.targetWorldSize} m`
        : `${resource.presentation.targetWorldSize} m, water ${resource.presentation.waterOffset} m`;
      return [
        resource.name,
        skillName(resource.skill),
        resource.tier,
        resource.reqLevel,
        itemLink(resource.itemId),
        secondary,
        lifecycle.xpEach,
        lifecycle.perNode,
        lifecycle.recovery,
        resource.presentation.availableAssetIds.join(", "),
        resource.presentation.depletedAssetId ?? "Renderer fallback",
        size,
      ];
    });
  return page("Resources", "Gathering nodes, requirements, yields, respawns, and authored presentation from the live resource table.", table(
    ["Node", "Skill", "Tier", "Level", "Primary", "Secondary", "XP each", "Per node", "Respawn", "Available assets", "Depleted asset", "Target size"],
    rows,
  ));
}

function regionsDoc(): string {
  const sections = REGIONS.map((region) => {
    const places = region.locations.map((location) => [
      `### ${location.name}`,
      "",
      capture("location", location.id, location.name),
      "",
      location.blurb ?? `${location.name} is a ${location.kind.replace(/_/g, " ")} in ${region.name}.`,
      "",
      `**Tier:** ${region.tier} · **Type:** ${location.kind.replace(/_/g, " ")}`,
    ].join("\n")).join("\n\n");
    const dungeon = region.dungeon
      ? [
          `## ${region.dungeon.name}`,
          "",
          `Tier ${region.dungeon.tier}. Enter through [The Gravelmaw](#the-gravelmaw).`,
          "",
          region.dungeon.locations.map((location) => [
            `### ${location.name}`,
            "",
            capture("location", location.id, location.name),
            "",
            location.blurb ?? `${location.name} is a ${location.kind.replace(/_/g, " ")} in ${region.dungeon!.name}.`,
            "",
            `**Tier:** ${region.dungeon!.tier} · **Type:** ${location.kind.replace(/_/g, " ")}`,
          ].join("\n")).join("\n\n"),
        ].join("\n")
      : "";
    return [
      `## ${region.name}`,
      "",
      region.lore,
      "",
      `Tier ${region.tier}. Settlement: **${region.settlement?.name ?? "Uninhabited"}**.`,
      "",
      places,
      dungeon,
    ].join("\n");
  });
  return page("Regions", "Corealm's regions, settlements, routes, landmarks, gathering sites, and dungeon rooms.", [
    locationMap(),
    sections.join("\n\n"),
  ].join("\n\n"));
}

function npcsDoc(): string {
  const sections = NPCS.map((person) => {
    const place = placeById(person.locationId);
    const quests = person.questIds.length
      ? person.questIds.map((id) => `- [${QUESTS.find((quest) => quest.id === id)?.name ?? id}](../quests/${id}/)`).join("\n")
      : "_No quest._";
    return [
      `## ${person.name}`,
      "",
      capture("npc", person.id, person.name),
      "",
      person.role,
      "",
      `**Found at:** ${place?.location.name ?? person.locationId}, ${regionName(person.regionId)}`,
      "",
      "### Quests",
      "",
      quests,
    ].join("\n");
  });
  return page("People", "Every named NPC, where to find them, and the quests they give.", sections.join("\n\n"));
}

function grantRows(grant: QuestGrant | undefined, itemBase = "./"): (string | number)[][] {
  if (!grant) return [];
  const rows: (string | number)[][] = [];
  for (const [skill, xp] of Object.entries(grant.xp ?? {})) rows.push([`${skillName(skill as SkillId)} XP`, xp ?? 0]);
  for (const stack of grant.items ?? []) rows.push([itemLink(stack.itemId, itemName(stack.itemId), itemBase), stack.quantity]);
  if (grant.currency) rows.push(["Marks", grant.currency]);
  for (const unlock of grant.unlocks ?? []) rows.push(["Unlock", unlock]);
  return rows;
}

function rewardSummary(grant: QuestGrant, itemBase: string): string {
  const parts: string[] = [];
  for (const [skill, xp] of Object.entries(grant.xp ?? {})) {
    if (xp) parts.push(`${xp.toLocaleString()} ${skillName(skill as SkillId)} XP`);
  }
  for (const stack of grant.items ?? []) {
    parts.push(`${stack.quantity}× ${itemLink(stack.itemId, itemName(stack.itemId), itemBase)}`);
  }
  if (grant.currency) parts.push(`${grant.currency.toLocaleString()} Marks`);
  for (const unlock of grant.unlocks ?? []) parts.push(unlock);
  return parts.join("; ") || "None";
}

function questStartPlace(quest: QuestDef): PlaceRecord {
  const giver = npcGivingQuest(quest.id) ?? npc(quest.giverNpcId);
  const place = giver && placeById(giver.locationId);
  if (!place) throw new Error(`Quest ${quest.id} has no authored start location.`);
  return place;
}

function questIndexDoc(): string {
  const rows = QUESTS.map((quest) => {
    const start = questStartPlace(quest);
    return [
      `[${quest.name}](./${quest.id}/)`,
      `[${start.location.name}](../regions/#${headingSlug(start.location.name)})`,
      rewardSummary(quest.rewards, "../"),
    ];
  });
  return page("Quests", "Every Corealm quest, its start location, and its completion reward.", table(
    ["Quest", "Start location", "Reward"],
    rows,
  ));
}

function questDoc(quest: QuestDef): string {
  const giver = npcGivingQuest(quest.id) ?? npc(quest.giverNpcId);
  const start = questStartPlace(quest);
  const requirements = Object.entries(quest.requirements)
    .map(([skill, level]) => `${skillName(skill as SkillId)} ${level}`)
    .join(", ") || "None";
  const prerequisites = quest.prerequisiteQuestIds
    .map((id) => {
      const prerequisite = QUESTS.find((candidate) => candidate.id === id);
      return `[${prerequisite?.name ?? id}](../${id}/)`;
    })
    .join(", ") || "None";
  const stages = quest.stages.map((stage) => {
    const grants = grantRows(stage.grants, "../../");
    return [
      `### ${stage.index + 1}. ${stage.objective}`,
      "",
      stage.hint,
      "",
      questStepEvidence(quest, stage),
      grants.length ? `\n#### Stage reward\n\n${table(["Reward", "Amount"], grants)}` : "",
    ].join("\n");
  }).join("\n\n");
  const rewards = grantRows(quest.rewards, "../../");
  const supplied = grantRows(quest.onStart, "../../");
  return page(quest.name, `${quest.name} start location, requirements, walkthrough, and rewards.`, [
    quest.summary,
    "",
    giver ? capture("npc", giver.id, giver.name, "../") : "",
    "",
    table(["Giver", "Start location", "Region", "Requirements", "Prerequisite"], [[
      giver ? `[${giver.name}](../../npcs/#${headingSlug(giver.name)})` : quest.giverNpcId,
      `[${start.location.name}](../../regions/#${headingSlug(start.location.name)})`,
      `[${regionName(quest.regionId)}](../../regions/#${headingSlug(regionName(quest.regionId))})`,
      requirements,
      prerequisites,
    ]]),
    "",
    supplied.length ? `## Supplied when accepted\n\n${table(["Item", "Amount"], supplied)}` : "",
    "",
    "## Walkthrough",
    "",
    stages,
    "",
    "## Completion rewards",
    "",
    rewards.length ? table(["Reward", "Amount"], rewards) : "_No additional reward._",
  ].join("\n"));
}

function spellsAndShopsDoc(): string {
  const spellRows = SPELLS.map((spell) => [
    spell.name, spell.reqLevel, spell.baseMax, spell.divisor, spell.baseXp,
    "2.2 s wand / 3.0 s staff", `${spell.cost.charges}× ${elementName(spell.cost.element)} weapon charge or Essence`,
  ]);
  const orbRows = ALL_ITEMS.filter((item) => item.orb).map((item) => {
    const orb = item.orb!;
    const charge = ALL_ITEMS.find((candidate) => candidate.magicWeapon?.charge?.orbItemId === item.id)
      ?.magicWeapon?.charge;
    return [
      itemLink(item.id),
      item.tier,
      elementName(orb.element),
      "Awakens the regional altar for both weapon types",
      charge ? itemName(charge.rechargeItemId) : "-",
      orb.released ? "Released" : "Future content",
    ];
  });
  const chargedWeaponRows = ALL_ITEMS.filter((item) => item.magicWeapon?.charge).map((item) => {
    const charge = item.magicWeapon!.charge!;
    return [
      itemLink(item.id),
      elementName(charge.element),
      charge.capacity,
      `${charge.rechargeCost}× ${itemName(charge.rechargeItemId)}`,
      charge.released ? "Released" : "Future content",
    ];
  });
  const shopSections = SHOPS.map((shop) => {
    const rows = shop.stock.map((entry) => {
      const item = content.item(entry.itemId);
      return [itemLink(entry.itemId, item?.name ?? entry.itemId), entry.quantity, Math.round((item?.value ?? 0) * shop.buyMultiplier)];
    });
    return `### ${shop.name}\n\n${table(["Item", "Stock", "Price"], rows)}`;
  });
  return page("Spells and shops", "Spell costs and shop inventories from the live economy tables.", [
    "## Spells",
    "",
    table(["Spell", "Magic level", "Base max", "Divisor", "XP", "Cast time", "Cost"], spellRows),
    "",
    "## Elemental orbs",
    "",
    "Boss orbs are singleton altar keys, not equipment. Use one on the dormant altar at the matching Essence Cache. The awakened altar then makes both matching wood-tier wands and staffs as elemental weapons with 1,000 charges.",
    "",
    table(["Orb", "Tier", "Element", "Use", "Matching Essence", "Status"], orbRows),
    "",
    "## Charged elemental weapons",
    "",
    "A matching weapon charge pays for the cast first. At zero charge, the weapon keeps casting from carried matching Essence. The matching awakened Essence Altar consumes 100 Essence to refill the equipped weapon to 1,000.",
    "",
    table(["Weapon", "Element", "Capacity", "Full recharge", "Status"], chargedWeaponRows),
    "",
    "## Shops",
    "",
    shopSections.join("\n\n"),
  ].join("\n"));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const out = path.resolve(repoRoot, argValue(args, "--out") ?? "docs/game");
  const provenanceOut = path.resolve(
    repoRoot,
    argValue(args, "--provenance-out") ?? "docs/asset-provenance-gathering.md",
  );
  await mkdir(out, { recursive: true });

  content.register({
    items: ALL_ITEMS, resources: RESOURCES, recipes: RECIPES,
    spells: SPELLS, enemies: ENEMIES, shops: SHOPS,
  });
  const manifest = JSON.parse(
    await readFile(path.resolve(repoRoot, "game/public/assets/manifest.json"), "utf8"),
  ) as AssetManifest;

  for (const stale of ["quests.md", "enemies.md", "locations.md", "items.md", "quests", "creatures", "items"]) {
    await rm(path.join(out, stale), { recursive: true, force: true });
  }

  const files: [string, string][] = [
    ["quests/index.md", questIndexDoc()],
    ...QUESTS.map((quest): [string, string] => [`quests/${quest.id}.md`, questDoc(quest)]),
    ["npcs.md", npcsDoc()],
    ["creatures/index.md", creatureIndexDoc()],
    ...guideCreatures().map((creature): [string, string] => [`creatures/${creature.id}.md`, creatureDoc(creature)]),
    ["regions.md", regionsDoc()],
    ["items/index.md", itemsDoc()],
    ...sortedGuideItems().map((item): [string, string] => [`items/${item.id}.md`, itemDetailDoc(item)]),
    ["recipes.md", recipesDoc()],
    ["resources.md", resourcesDoc()],
    ["skills.md", skillsDoc()],
    ["gathering-production.md", gatheringProductionDoc()],
    ["campfires.md", campfiresDoc()],
    ["experience.md", xpDoc()],
    ["spells-and-shops.md", spellsAndShopsDoc()],
  ];

  const index = page("Game guide", "Generated guides for Corealm's quests, people, creatures, regions, and systems.", [
    "These pages are regenerated from the same content tables the game runs.",
    "",
    "- [Quests](./quests)",
    "- [People](./npcs)",
    "- [Creatures](./creatures)",
    "- [Regions](./regions)",
    "- [Items](./items)",
    "- [Recipes](./recipes)",
    "- [Resources](./resources)",
    "- [Skills](./skills)",
    "- [Gathering and production](./gathering-production)",
    "- [Campfires](./campfires)",
    "- [Experience table](./experience)",
    "- [Spells and shops](./spells-and-shops)",
  ].join("\n"));

  const iconSource = path.resolve(repoRoot, "art/item-icons/256");
  const iconTarget = path.join(out, "assets/items");
  await rm(iconTarget, { recursive: true, force: true });
  await mkdir(path.dirname(iconTarget), { recursive: true });
  await cp(iconSource, iconTarget, { recursive: true });
  await sharp(path.resolve(repoRoot, "game/public/generated/world-map.png"))
    .resize({ width: 2400, withoutEnlargement: true })
    .webp({ quality: 88, effort: 6, smartSubsample: true })
    .toFile(path.join(out, "assets/world-map.webp"));

  await writeFile(path.join(out, "README.md"), index, "utf8");
  for (const [name, body] of files) {
    const target = path.join(out, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, "utf8");
  }
  await mkdir(path.dirname(provenanceOut), { recursive: true });
  await writeFile(provenanceOut, gatheringAssetProvenanceDoc(manifest), "utf8");
  console.log(
    `Wrote ${files.length + 1} guide files to ${path.relative(repoRoot, out)} `
    + `and gathering provenance to ${path.relative(repoRoot, provenanceOut)}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
