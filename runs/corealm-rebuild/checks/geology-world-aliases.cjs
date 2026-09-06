/**
 * Rewrites the world alias catalogue from the staged geology catalogue. The world landing check
 * substitutes unpromoted candidate bytes under the authored legacy asset IDs, so the two files
 * must always describe the same GLBs. Never hand-edit the alias hashes.
 *
 *   node runs/corealm-rebuild/checks/geology-world-aliases.cjs
 */
const fs = require("node:fs");
const staged = "art/rebuild/candidates/finish-structures/corealm-geology.json";
const aliases = "art/rebuild/candidates/finish-structures/world-geology-aliases.json";
const legacy = { corealm_sunder_ledge: "cliff_step_2", corealm_scree_slide: "cliff_step_3" };
const source = JSON.parse(fs.readFileSync(staged, "utf8"));
const unknown = source.assets.filter((asset) => legacy[asset.id] === undefined);
if (unknown.length > 0) throw new Error(`No legacy alias for ${unknown.map((a) => a.id).join(", ")}`);
const out = {
  pack: source.pack, generator: source.generator, generatorSha256: source.generatorSha256,
  coordinates: source.coordinates, oreMount: source.oreMount, construction: source.construction,
  assets: source.assets.map((asset) => ({ ...asset, id: legacy[asset.id] })),
  files: Object.fromEntries(source.assets.map((asset) => [legacy[asset.id], asset.file])),
  candidateAliases: source.assets.map((asset) => ({
    semanticId: legacy[asset.id], nativeCandidateId: asset.id, sha256: asset.sha256,
  })),
};
fs.writeFileSync(aliases, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ aliases, generatorSha256: out.generatorSha256, assets: out.candidateAliases }));
