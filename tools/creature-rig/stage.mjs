/**
 * Step 6: record a candidate in <rig root>/catalog.json in the format tools/promote-finish-assets.ts
 * reads. Identity fields come from the manifest entry; everything measurable is recomputed from the
 * candidate. Stale per-file metadata (timing tables, death repair notes) is deliberately not
 * copied: the root owns those and the clip seconds are listed in motionProvenance for it.
 *
 *   node tools/creature-rig/stage.mjs <assetId>
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { accessor, readGlb } from "./glb.mjs";
import { isMain, paths } from "./paths.mjs";

export function measure(file) {
  const glb = readGlb(file);
  const { json } = glb;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const mesh of json.meshes) for (const p of mesh.primitives) {
    const pos = accessor(glb, p.attributes.POSITION);
    for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a], pos[i + a]);
      max[a] = Math.max(max[a], pos[i + a]);
    }
    triangles += (p.indices === undefined ? pos.length / 3 : json.accessors[p.indices].count) / 3;
  }
  const clipSeconds = Object.fromEntries((json.animations ?? []).map((a) => [a.name, Math.max(...a.samplers.map((s) => json.accessors[s.input].max[0]))]));
  return {
    bounds: { min, max },
    size: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
    base: { x: min[0], y: min[1], z: min[2] },
    triangles,
    animations: (json.animations ?? []).map((a) => a.name),
    materials: (json.materials ?? []).map((m) => m.name),
    clipSeconds,
  };
}

export function stage(assetId, work = paths.work(assetId)) {
  const intake = JSON.parse(readFileSync(path.join(work, "intake.json"), "utf8"));
  const rig = JSON.parse(readFileSync(path.join(work, "rig.json"), "utf8"));
  const entry = intake.production.manifest;
  const candidateFile = path.join("models", entry.file.replace(/^models\//, "")).replaceAll("\\", "/");
  const file = path.join(paths.rigRoot, candidateFile);
  const bytes = readFileSync(file);
  const m = measure(file);
  const donor = Object.fromEntries(rig.clips.map((c) => {
    const [key, clip] = c.donor.split(":");
    return [c.name, `${rig.donors[key] ?? key}: ${clip.replaceAll("+", " + ")}`];
  }));
  const chains = rig.skeleton.filter((b) => b.kind === "cloth" || b.kind === "tail").map((b) => b.name);
  const record = {
    id: assetId,
    file: entry.file,
    pack: entry.pack,
    category: entry.category,
    is: entry.is,
    tags: entry.tags,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: m.size,
    base: m.base,
    bounds: m.bounds,
    groundY: 0,
    triangles: m.triangles,
    animations: m.animations,
    materials: m.materials,
    candidateFile,
    motionProvenance: {
      native: [],
      donor,
      authored: [],
      notes: [
        `Rebuilt by tools/creature-rig (${rig.class}/${rig.profile}): production mesh, UVs and materials kept; skeleton fitted to the mesh; bone-heat weights; rest == bind.`,
        "Donor clips retargeted rest-relative at 30 fps; hips translation scaled by leg length; foot IK to the donor's scaled ankle, ball and toe paths; in place; no scale keys.",
        chains.length ? `Follow-through chains (${chains.join(", ")}) are a damped spring simulation driven by the retargeted body, with leg/torso capsules and the floor as colliders; not keyed by hand.` : null,
        rig.clips.some((c) => c.lyingLift > 0) ? `Lying clips lift the hips by a smooth penetration envelope (end lift ${rig.clips.filter((c) => c.lyingLift > 0).map((c) => `${c.name} ${c.lyingLift.toFixed(3)} m`).join(", ")}).` : null,
      ].filter(Boolean).join(" "),
      clipSeconds: m.clipSeconds,
      sourceFile: intake.source.kind === "tripo-rig" ? intake.source.file : intake.production.file,
      sourceSha256: intake.production.sha256,
    },
  };
  const catalogFile = path.join(paths.rigRoot, "catalog.json");
  const catalog = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, "utf8")) : { assets: [] };
  catalog.assets = [...catalog.assets.filter((a) => a.id !== assetId), record].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(catalogFile, JSON.stringify(catalog, null, 2));
  return record;
}

if (isMain(import.meta)) {
  for (const id of process.argv.slice(2)) console.log(JSON.stringify(stage(id).motionProvenance, null, 1));
}
