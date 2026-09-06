import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRpgRegionalPackCatalogue, RPG_REGIONAL_PACK_PLAN, type RpgPackModelMeasurement } from "../game/src/content/rpgRegionalPacks.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { RPG_BESTIARY } from "../game/src/content/rpgBestiary.js";

type MeasuredAsset = RpgPackModelMeasurement & { id: string };
const publicAssets = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: MeasuredAsset[] };
const catalogueFlag = process.argv.indexOf("--catalogue");
const cataloguePath = catalogueFlag >= 0 ? process.argv[catalogueFlag + 1]! : "art/rebuild/candidates/finish-bestiary/retained-unhorned15/catalog.json";
const catalogueText = readFileSync(cataloguePath, "utf8");
const candidates = JSON.parse(catalogueText) as { assets: MeasuredAsset[] };
for (const species of RPG_BESTIARY.filter(row => RPG_REGIONAL_PACK_PLAN.some(pack => pack.speciesId === row.id))) {
  if (![...publicAssets.assets, ...candidates.assets].some((asset) => asset.id === species.assetId)) throw new Error(`Candidate catalogue is incomplete: ${species.assetId}`);
}
const assets = new Map([...publicAssets.assets, ...candidates.assets].map((asset) => [asset.id, asset]));
const failures: { packId: string; speciesId: string | null; error: string }[] = [];
for (const row of RPG_REGIONAL_PACK_PLAN) {
  try { createRpgRegionalPackCatalogue((id) => assets.get(id) ?? null, [row.packId]); }
  catch (error) { failures.push({ ...row, error: String(error) }); }
}
const catalogue = failures.length ? null : createRpgRegionalPackCatalogue((id) => assets.get(id) ?? null);
const tightestPacks = catalogue?.packs.map((pack) => {
  const size = assets.get(pack.assetId)!.size;
  const radii = pack.members.map((member) => {
    const variant = catalogue.variants.find((row) => row.id === member.variantId)!;
    return Math.max(size.x, size.z) * pack.scale * tierSilhouetteScale(variant.stats.tier) * variant.scaleMultiplier / 2;
  });
  let margin = Infinity;
  for (let a = 0; a < pack.anchors.length; a++) for (let b = a + 1; b < pack.anchors.length; b++) {
    margin = Math.min(margin, Math.hypot(pack.anchors[a]![0] - pack.anchors[b]![0], pack.anchors[a]![1] - pack.anchors[b]![1]) - radii[a]! - radii[b]!);
  }
  return { packId: pack.id, speciesId: pack.speciesId, minimumBodyGapMetres: Math.round(margin * 1000) / 1000 };
}).sort((a, b) => a.minimumBodyGapMetres - b.minimumBodyGapMetres).slice(0, 6);
console.log(JSON.stringify({
  cataloguePath, catalogueSha256: createHash("sha256").update(catalogueText).digest("hex"),
  accepted: !failures.length, packs: RPG_REGIONAL_PACK_PLAN.length,
  members: catalogue?.packs.reduce((sum, pack) => sum + pack.members.length, 0),
  variants: catalogue?.variants.length,
  tightestPacks,
  largestModels: [...assets.values()].filter(asset => RPG_BESTIARY.some(species => species.assetId === asset.id)).map(({ id, size }) => ({ id, width: size.x, depth: size.z }))
    .sort((a, b) => Math.max(b.width, b.depth) - Math.max(a.width, a.depth)).slice(0, 6),
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
