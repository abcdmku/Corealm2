/**
 * CPU audit of each authored mine's cut face against the production terrain lattice.
 *
 * Builds the real world terrain in a window around every mine, generates the production cut
 * face, and measures how much of the shell is exposed above the actual rendered terrain
 * triangles, classified by facing. Exposed rear- or side-facing stone and exposed roof behind
 * the crest are the "rear shoulder" defects; front-facing stone above the work floor is the
 * intended cliff. No browser is launched. Run with `npx tsx tools/mine-rear-wall-audit.ts [--json]`.
 */
import * as THREE from "three";
import type { SemanticEntity } from "../game/src/contracts.js";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { WORLD_SITES, worldSitePoint, type WorldSite } from "../game/src/content/worldSites.js";
import type { AssetRegistry } from "../game/src/render/assets.js";
import { buildMineCutFace, createMineBurialSampler } from "../game/src/render/mineCutFace.js";
import { WorldScene } from "../game/src/render/scene.js";

export interface MineExposure {
  site: string;
  triangles: number;
  /** Square metres of shell more than `EXPOSURE` above the terrain triangle under its centroid. */
  exposed: { front: number; rear: number; side: number; top: number; bottom: number };
  /**
   * Ground the exposed shell covers behind the crest lip, square metres of horizontal projection.
   * Surface area alone cannot separate a flat roof from a steep back slope of the same reach, and
   * it is the ground a rear or overhead camera sees stone lying on that makes a mine read wrong.
   */
  planBehindCrest: number;
  /** Highest rear- or side-facing exposed point above terrain, metres. */
  maxRearRise: number;
  maxSideRise: number;
  /** Per station: crest height minus terrain at 1.5 m and 3 m behind the crest lip. */
  stations: { id: string; crestY: number; bankDeficit1_5: number; bankDeficit3: number }[];
}

const EXPOSURE = 0.15;

function stubAssets(): AssetRegistry {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  material.name = "Corealm weathered strata";
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(
    Array.from({ length: geometry.getAttribute("position").count }, () => [0.31, 0.28, 0.24]).flat(), 3));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material));
  return { load: async () => group } as unknown as AssetRegistry;
}

export function mineWindowScene(site: WorldSite, reach = 44): WorldScene {
  const spec = buildWorldTerrainSpec();
  // Keep the 2 m lattice phase of the production world so triangle diagonals match.
  const even = (value: number) => Math.floor(value / 2) * 2;
  const bounds = {
    minX: Math.max(spec.bounds.minX, even(site.centre[0] - reach)),
    maxX: Math.min(spec.bounds.maxX, even(site.centre[0] + reach)),
    minZ: Math.max(spec.bounds.minZ, even(site.centre[1] - reach)),
    maxZ: Math.min(spec.bounds.maxZ, even(site.centre[1] + reach)),
  };
  const scene = new WorldScene(new THREE.Scene());
  scene.buildWorld({ ...spec, bounds, chunkSize: Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) });
  return scene;
}

export function stationEntities(site: WorldSite, scene: WorldScene): SemanticEntity[] {
  return site.resourceSlots.map((slot) => {
    const [x, z] = worldSitePoint(site, slot.x, slot.z);
    return {
      id: `${slot.clusterId}_${slot.index}`, archetype: "ore", name: "Ore", tier: 1, regionId: site.regionId,
      position: [x, scene.meshHeightAt(x, z), z], state: "available", interactions: ["mine"],
    } as SemanticEntity;
  });
}

export async function auditMine(site: WorldSite): Promise<MineExposure> {
  const scene = mineWindowScene(site);
  try {
    const { objects } = await buildMineCutFace(scene, stubAssets(), site, stationEntities(site, scene));
    const mesh = objects[0] as THREE.Mesh;
    const ground = createMineBurialSampler(scene);
    const forward = new THREE.Vector3(Math.sin(site.rotationY), 0, Math.cos(site.rotationY));
    const right = new THREE.Vector3(Math.cos(site.rotationY), 0, -Math.sin(site.rotationY));
    const position = mesh.geometry.getAttribute("position");
    const exposed = { front: 0, rear: 0, side: 0, top: 0, bottom: 0 };
    let maxRearRise = 0; let maxSideRise = 0; let planBehindCrest = 0;
    const setbackForPlan = site.cutFace?.frontSetback ?? 2.4;
    const lips = (site.cutFace?.stations ?? []).map((station) => {
      const slot = site.resourceSlots.find((entry) => entry.clusterId === station.clusterId && entry.index === station.index)!;
      const [x, z] = worldSitePoint(site, slot.x, slot.z);
      return new THREE.Vector3(x, 0, z).addScaledVector(forward, -setbackForPlan);
    });
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const normal = new THREE.Vector3(), centroid = new THREE.Vector3();
    for (let index = 0; index < position.count; index += 3) {
      a.fromBufferAttribute(position, index); b.fromBufferAttribute(position, index + 1); c.fromBufferAttribute(position, index + 2);
      normal.crossVectors(b.clone().sub(a), c.clone().sub(a));
      const area = normal.length() / 2;
      if (area < 1e-9) continue;
      normal.divideScalar(area * 2);
      centroid.copy(a).add(b).add(c).divideScalar(3);
      const rise = centroid.y - ground(centroid.x, centroid.z);
      if (rise <= EXPOSURE) continue;
      const along = normal.dot(forward), across = normal.dot(right);
      // Behind the nearest station's cut-face plane, so the intended cliff face is excluded.
      const nearest = lips.reduce((best, lip) => {
        const offset = centroid.clone().sub(lip).dot(forward);
        return Math.abs(offset) < Math.abs(best) ? offset : best;
      }, Infinity);
      if (nearest < -0.05 && normal.y > 0) planBehindCrest += area * Math.abs(normal.y);
      if (normal.y > 0.6) exposed.top += area;
      else if (normal.y < -0.6) exposed.bottom += area;
      else if (along > 0.35) exposed.front += area;
      else if (along < -0.35) { exposed.rear += area; maxRearRise = Math.max(maxRearRise, rise); }
      else if (Math.abs(across) > 0.5) { exposed.side += area; maxSideRise = Math.max(maxSideRise, rise); }
      else exposed.front += area;
    }
    const setback = site.cutFace?.frontSetback ?? 2.4;
    const stations = (site.cutFace?.stations ?? []).map((station) => {
      const slot = site.resourceSlots.find((entry) => entry.clusterId === station.clusterId && entry.index === station.index)!;
      const [x, z] = worldSitePoint(site, slot.x, slot.z);
      const lip = new THREE.Vector3(x, 0, z).addScaledVector(forward, -setback);
      const crestY = scene.meshHeightAt(lip.x, lip.z) + station.crestHeight;
      const behind = (metres: number) => { const p = lip.clone().addScaledVector(forward, -metres); return crestY - ground(p.x, p.z); };
      return { id: `${station.clusterId}_${station.index}`, crestY: round(crestY), bankDeficit1_5: round(behind(1.5)), bankDeficit3: round(behind(3)) };
    });
    mesh.geometry.dispose();
    return {
      site: site.id, triangles: position.count / 3,
      exposed: Object.fromEntries(Object.entries(exposed).map(([k, v]) => [k, round(v)])) as MineExposure["exposed"],
      planBehindCrest: round(planBehindCrest),
      maxRearRise: round(maxRearRise), maxSideRise: round(maxSideRise), stations,
    };
  } finally { scene.dispose(); }
}

function round(value: number): number { return Math.round(value * 1000) / 1000; }

const invokedDirectly = process.argv[1] && /mine-rear-wall-audit\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  const json = process.argv.includes("--json");
  const results: MineExposure[] = [];
  for (const site of WORLD_SITES.filter((entry) => entry.kind === "mine")) results.push(await auditMine(site));
  if (json) console.log(JSON.stringify(results, null, 2));
  else {
    console.log("site | tris | front m2 | rear m2 | side m2 | top m2 | bottom m2 | plan behind crest m2 | max rear rise | max side rise");
    for (const r of results) {
      console.log(`${r.site} | ${r.triangles} | ${r.exposed.front} | ${r.exposed.rear} | ${r.exposed.side} | ${r.exposed.top} | ${r.exposed.bottom} | ${r.planBehindCrest} | ${r.maxRearRise} | ${r.maxSideRise}`);
      for (const s of r.stations) console.log(`    ${s.id}: crest ${s.crestY}  deficit@1.5m ${s.bankDeficit1_5}  @3m ${s.bankDeficit3}`);
    }
  }
}
