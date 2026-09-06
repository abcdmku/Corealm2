/** CPU-only Recast check on the real authored lab terrain and production dressing solid boxes. */
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { COMBAT_LAB_BOOT_PROFILE } from "../game/src/app/bootProfile.js";
import { createRpgRegionalPackCatalogue } from "../game/src/content/rpgRegionalPacks.js";
import { assembleRegionalPackFixture } from "../game/src/featureLab/regionalPacks.js";
import type { AssetRegistry } from "../game/src/render/assets.js";
import { WorldScene } from "../game/src/render/scene.js";
import { Navigation, solidObstacleMeshes } from "../game/src/systems/navigation.js";
import { Solids } from "../game/src/systems/solids.js";
import { buildRegionalPackDressing } from "../game/src/world/regionalPackDressing.js";
import { habitatIdleTargets } from "../game/src/world/habitatMovement.js";

const selectedPacksArgument = process.argv.indexOf("--packs");
const ids = selectedPacksArgument >= 0 ? process.argv[selectedPacksArgument + 1]!.split(",") : [
  "pack_fallowmarch_palewood_northwest_watch",
  "pack_fallowmarch_northgate_west_scrub",
  "pack_karrowmoor_highcairn_south_wall_mandibles",
  "pack_karrowmoor_tideworn_east_watch",
  "pack_kilnhalt_ashback_northeast_range",
];
const argument = process.argv.indexOf("--catalogue");
const source = argument < 0 ? "art/rebuild/candidates/finish-bestiary/retained-unhorned15/catalog.json" : process.argv[argument + 1]!;
type Measured = { id: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } };
const publicAssets = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as { assets: Measured[] };
const candidateAssets = JSON.parse(readFileSync(source, "utf8")) as { assets: Measured[] };
const measurements = new Map([...publicAssets.assets, ...candidateAssets.assets].map((row) => [row.id, row]));
// Rendering sources are empty CPU groups. Placement/grounding/solid construction reads the real
// manifest dimensions through the production helper; no GLB or texture is claimed as reviewed.
const assets = {
  assetSize: (id: string) => measurements.get(id)?.size ?? null,
  baseY: (id: string) => measurements.get(id)?.base.y ?? 0,
  assetCenterXZ: (id: string) => {
    const entry = measurements.get(id)!;
    return { x: entry.base.x + entry.size.x / 2, z: entry.base.z + entry.size.z / 2 };
  },
  load: async () => new THREE.Group(),
} as unknown as AssetRegistry;
const scene = new WorldScene(new THREE.Scene());
scene.buildWorld(COMBAT_LAB_BOOT_PROFILE.terrain());
const catalogue = createRpgRegionalPackCatalogue((id) => measurements.get(id) ?? null, ids);
await Navigation.initLibrary();
const reports = [];
for (const id of ids) {
  const fixture = assembleRegionalPackFixture(id, {
    heightAt: (x, z) => scene.meshHeightAt(x, z), baseY: (assetId) => assets.baseY(assetId),
    assetSize: (assetId) => assets.assetSize(assetId),
  }, catalogue);
  const dressing = await buildRegionalPackDressing(scene, assets, fixture.habitat,
    Math.max(...fixture.entities.map((entity) => entity.combat?.bodyRadius ?? 0)));
  const nav = new Navigation();
  const carves = solidObstacleMeshes(dressing.navigationSolids);
  const ready = nav.build([...scene.getWalkableMeshes(), ...carves]);
  const solids = new Solids(dressing.solids);
  const failures: string[] = [];
  let routes = 0;
  if (!ready) failures.push("navmesh build failed");
  else {
    const approachZ = fixture.habitat.centre[1] + Math.max(2.5, fixture.habitat.radius * 0.35);
    const target: [number, number, number] = [fixture.habitat.centre[0],
      scene.meshHeightAt(fixture.habitat.centre[0], approachZ), approachZ];
    for (const [from, to] of [[fixture.spawn, target], [target, fixture.spawn]] as const) {
      const path = nav.findPath(from, to);
      const end = path?.at(-1);
      if (!end || Math.hypot(end[0] - to[0], end[2] - to[2]) > 0.35) failures.push("player approach/exit blocked");
    }
  }
  if (ready) for (const entity of fixture.entities) {
    const points = [entity.position, ...habitatIdleTargets(entity.id, entity.position, fixture.habitat).candidates.map((row) => row.position)];
    for (let a = 0; a < points.length; a++) for (let b = 0; b < points.length; b++) {
      if (a === b) continue;
      routes++;
      const from = points[a]!, to = points[b]!;
      const path = nav.findPath([from[0], scene.meshHeightAt(from[0], from[2]), from[2]],
        [to[0], scene.meshHeightAt(to[0], to[2]), to[2]]);
      const end = path?.at(-1);
      if (!end || Math.hypot(end[0] - to[0], end[2] - to[2]) > 0.35) failures.push(`${entity.id}: ${a}->${b} missed arrival`);
      if (path) for (let leg = 1; leg < path.length; leg++) {
        const start = path[leg - 1]!, finish = path[leg]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(finish[0] - start[0], finish[2] - start[2]) / 0.5));
        for (let step = 0; step <= steps; step++) {
          const x = start[0] + (finish[0] - start[0]) * step / steps;
          const z = start[2] + (finish[2] - start[2]) * step / steps;
          const position: [number, number, number] = [x, scene.meshHeightAt(x, z), z];
          const resolved = solids.resolve(position, position, entity.combat!.bodyRadius!);
          if (Math.hypot(resolved[0] - x, resolved[2] - z) > 0.001) {
            if (failures.length < 20) failures.push(`${entity.id}: ${a}->${b} body intersects dressing`);
            break;
          }
        }
      }
    }
  }
  reports.push({ packId: id, pieces: dressing.placed, solids: dressing.solids.length, routes, failures });
  for (const carve of carves) carve.geometry.dispose();
}
console.log(JSON.stringify({ accepted: reports.every((row) => !row.failures.length),
  source, proof: "CPU Recast on production lab terrain and production measured dressing solids; no rendering acceptance", reports }, null, 2));
if (reports.some((row) => row.failures.length)) process.exitCode = 1;
