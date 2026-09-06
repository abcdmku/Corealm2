/** Normalize root-reviewed selections without publishing anything to game/public. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gearAppearance, gatheringToolAppearance, weaponAttachment } from "../../../game/src/render/equipmentVisuals.js";

const output = path.resolve("art/rebuild/candidates/2026-09-05/equipment-selected");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const selections = [
  { name: "minerals", catalog: "test-results/mineral-items-v8/catalog.json", ids: ["grithe_ore", "corven_ore", "kaldite_ore", "emberite_ore", "pale_quartz", "vell_amber", "cairn_garnet"].map(id => `corealm_item_${id}`) },
  { name: "weapons", catalog: "art/rebuild/candidates/2026-09-06/equipment-held-r3/catalogue.json", ids: [1, 2, 3, 4].map(grade => `corealm_sword_${grade}`).concat("corealm_axe_1") },
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
const bindings = ["worn", "grithe", "corven", "kaldite", "emberite"].flatMap(tier => ["sword", "hatchet"].map(kind => {
  const itemId = `${tier}_${kind}`;
  const appearance = kind === "sword" ? gearAppearance(itemId)! : gatheringToolAppearance(itemId)!;
  return { itemId, appearance, attachment: weaponAttachment(appearance) };
}));
await writeFile(path.join(output, "weapons", "bindings.json"), JSON.stringify({
  source: "game/src/render/equipmentVisuals.ts", sourceSha256: hash(await readFile("game/src/render/equipmentVisuals.ts")),
  scalePolicy: "Sword geometry carries grade length; common reviewed fit scale0.9. Worn sword remains0.774. One accepted axe construction intentionally retains previous per-tier tint/scale.",
  materialPolicy: "Replace metal tint once; source wood/leather retain their authored colours/maps. Original candidate metal has no metalness map, so imported metal shader treatment does not apply twice.",
  bindings,
}, null, 2));
