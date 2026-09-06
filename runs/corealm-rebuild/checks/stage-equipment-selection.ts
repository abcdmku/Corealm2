/** Normalize root-reviewed selections without publishing anything to game/public. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gearAppearance, gatheringToolAppearance, weaponAttachment } from "../../../game/src/render/equipmentVisuals.js";

const output = path.resolve("art/rebuild/candidates/2026-09-05/equipment-selected");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const mineralCatalog = process.env.MINERAL_CATALOG ?? "test-results/mineral-items/catalog.json";
const selections = [
  // All eight specimens are accepted now that the revised opal is promoted.
  { name: "minerals", catalog: mineralCatalog, ids: ["grithe_ore", "corven_ore", "kaldite_ore", "emberite_ore", "pale_quartz", "vell_amber", "cairn_garnet", "fire_opal"].map(id => `corealm_item_${id}`) },
  {
    name: "weapons", catalog: "art/rebuild/candidates/2026-09-06/equipment-held-r3/catalogue.json",
    ids: [
      ...[1, 2, 3, 4].map(grade => `corealm_sword_${grade}`), "corealm_axe_1",
      ...[1, 2, 3, 4].map(grade => `corealm_shield_${grade}`),
      ...[1, 2, 3, 4].map(grade => `corealm_staff_${grade}`),
      ...[1, 2, 3, 4].map(grade => `corealm_wand_${grade}`),
    ],
  },
];
for (const selection of selections) {
  const source = JSON.parse(await readFile(selection.catalog, "utf8"));
  const assets = source.assets.filter((asset: any) => selection.ids.includes(asset.id));
  assert.equal(assets.length, selection.ids.length);
  const directory = path.join(output, selection.name);
  const pack = { ...source.pack };
  const generator = await readFile(pack.source);
  if (!pack.generatorSha256) pack.generatorSha256 = hash(generator);
  if (hash(generator) === pack.generatorSha256) {
    await mkdir(path.join(directory, "provenance"), { recursive: true });
    await writeFile(path.join(directory, "provenance", path.basename(pack.source)), generator);
  }
  for (const asset of assets) {
    const bytes = await readFile(path.resolve(path.dirname(selection.catalog), source.files?.[asset.id] ?? asset.file));
    assert.equal(hash(bytes), asset.sha256, `${asset.id} hash`);
    assert.equal(bytes.length, asset.bytes, `${asset.id} size`);
    const destination = path.resolve(directory, asset.file);
    assert(destination.startsWith(directory + path.sep), "Selected asset must stay inside staging");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  await writeFile(path.join(directory, "catalog.json"), JSON.stringify({
    status: "root-reviewed-model-selection", pack, assets,
    acceptance: "Root accepted these model selections; icons and full animation acceptance remain separate.",
    evidence: selection.name === "minerals" ? ["test-results/mineral-v6-review/report.json", "test-results/mineral-v7-review/report.json"]
      : ["test-results/sword-grade-review/report.json", "test-results/equipment-held-candidates/report.json"],
  }, null, 2));
  console.log(`${assets.length} ${selection.name}: ${path.join(directory, "catalog.json")}`);
}
/**
 * Every held id and the exact transform the rig will use for it.
 *
 * Gathering tools resolve through `gatheringToolAppearance` because they are shown by activity
 * rather than by an equipped slot. Everything else, including the four dagger, shield, staff and
 * wand grades promoted in slice 13, resolves through `gearAppearance`.
 */
const HELD_ITEM_IDS = [
  ...["worn", "grithe", "corven", "kaldite", "emberite"].flatMap(tier => [`${tier}_sword`, `${tier}_dagger`]),
  ...["palewood", "duskoak", "cairnpine", "cinderpine"].map(wood => `${wood}_shield`),
  ...["basic_wooden", "palewood", "duskoak", "cairnpine", "cinderpine"].flatMap(wood => [`${wood}_staff`, `${wood}_wand`]),
  ...["air", "earth", "water", "fire"].flatMap(element => [`${element}_staff`, `${element}_wand`]),
  ...["galeskin", "mossbound", "tideworn", "cinderwake"].flatMap(region => [`${region}_sword`, `${region}_staff`]),
];
const TOOL_ITEM_IDS = ["worn", "grithe", "corven", "kaldite", "emberite"]
  .flatMap(tier => [`${tier}_pickaxe`, `${tier}_hatchet`]);
const bindings = [
  ...HELD_ITEM_IDS.map(itemId => ({ itemId, kind: "equipped" as const, appearance: gearAppearance(itemId) })),
  ...TOOL_ITEM_IDS.map(itemId => ({ itemId, kind: "activity" as const, appearance: gatheringToolAppearance(itemId) })),
].filter(row => row.appearance !== null)
  .map(row => ({ itemId: row.itemId, kind: row.kind, appearance: row.appearance!,
    attachment: weaponAttachment(row.appearance!) }));
await writeFile(path.join(output, "weapons", "bindings.json"), JSON.stringify({
  source: "game/src/render/equipmentVisuals.ts", sourceSha256: hash(await readFile("game/src/render/equipmentVisuals.ts")),
  scalePolicy: "Every promoted grade carries its own size progression, so nothing is scaled at bind time except the sword's reviewed 0.9 fit, the worn sword's 0.774, the wand's 1.22 readability fit and the pickaxe's 0.68 asset fit. The axe keeps its previous per-tier tint and scale.",
  materialPolicy: "The tier tint reaches the metal and blade roles only. Wood, leather and gem keep their authored colours and maps. Original candidate metal has no metalness map, so the imported metal shader treatment does not apply twice.",
  socketPolicy: "Held grips are on hand_r, shields strap to lowerarm_l, and the additive armour tier pieces ride spine_03 and pelvis. Every transform below is what CharacterRig.socketFor will use.",
  bindings,
}, null, 2));
