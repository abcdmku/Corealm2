import { Box3, Scene } from "three";
import { GAME_BOOT_PROFILE } from "../../app/bootProfile.js";
import { buildDungeonSpec } from "../../app/dungeonSpec.js";
import { resolveFairyDressing } from "../../app/fairyDressing.js";
import { registerExclusions } from "../../app/worldExclusions.js";
import { buildFairyTerrainSpec } from "../../app/worldSpec.js";
import { prepareWorldSurface } from "../../app/worldSurface.js";
import type { SolidVolume } from "../../contracts.js";
import { WORLD_SITES, type WorldSite } from "../../content/worldSites.js";
import { buildDungeon, dungeonNavigationBlockers } from "../../render/dungeon.js";
import { buildMineCutFace } from "../../render/mineCutFace.js";
import { WorldScene } from "../../render/scene.js";
import { buildStructureNavigationSources } from "../../render/structureNavigation.js";
import { buildWorldSiteDressing, type ResolvedWorldSiteDressing } from "../../render/worldSiteDressing.js";
import { Navigation } from "../../systems/navigation.js";
import { solidObstacleMeshes } from "../../systems/navigationObstacles.js";
import type { ForestTreeDescriptor } from "../../world/forestResources.js";
import { DEFAULT_SCATTER, scatterTilesForBounds, scatterWorldTile } from "../../world/scatter.js";
import { dryNavigationMeshes } from "../../world/waterNavigation.js";
import { assetMeasurements, buildAuthoredSemantic, type AssemblyTerrains, type AssetMeasurements, type AuthoredGeometry, type AuthoredSemantic } from "../worldAssembly.js";
import { SERVER_WORLD_PACK_VERSION, type ServerWorldPack, type PackedSeedWorld } from "../worldPack.js";
import { NodeGeometryAssets } from "./nodeGeometryAssets.js";

/**
 * Bake-time code. It builds the authored terrain with the renderer's `WorldScene` and reads model
 * triangles from the GLB files, so it loads three and gltf-transform. The server must never import
 * it: it boots from the pack this file produces. `tests/server-import-graph.test.ts` enforces that.
 */

/** The two terrain maps of one seed, and the asset library. */
export interface AuthoredSource {
  assets: NodeGeometryAssets;
  scene: WorldScene;
  fairyScene: WorldScene;
  terrains: AssemblyTerrains;
  measurements: AssetMeasurements;
}

export async function openAuthoredSource(seed: number, assetsDirectory = "game/public/assets"): Promise<AuthoredSource> {
  await Navigation.initLibrary();
  const assets = await NodeGeometryAssets.open(assetsDirectory);
  // The surface pass bends each road by the seed and grades the roads into the height lattice, so the ground itself is per seed.
  const scene = new WorldScene(new Scene());
  scene.buildWorld(GAME_BOOT_PROFILE.terrain(), prepared => prepareWorldSurface(prepared, seed));
  const fairyScene = new WorldScene(new Scene());
  fairyScene.buildWorld(buildFairyTerrainSpec(), prepared => prepareWorldSurface(prepared, seed));
  return { assets, scene, fairyScene, terrains: { main: scene, fairy: fairyScene, fairyExtent: fairyScene.getScatterBounds(Infinity) },
    measurements: assetMeasurements(id => assets.entry(id)) };
}

/** Site dressing, structures, the navmesh and the tree scatter for one seed's semantic world. */
export async function buildAuthoredGeometry(seed: number, source: AuthoredSource, semantic: AuthoredSemantic): Promise<AuthoredGeometry> {
  const { assets, scene, fairyScene } = source, { built } = semantic;
  const terrainAt = (x: number, z: number) => { const e = source.terrains.fairyExtent; return x >= e.minX && x <= e.maxX && z >= e.minZ && z <= e.maxZ ? fairyScene : scene; };
  const settings: WorldSite[] = [...WORLD_SITES, ...semantic.habitats.map((habitat): WorldSite => ({ id: habitat.id, locationId: habitat.groupId, regionId: habitat.regionId,
    centre: [0, 0], rotationY: 0, kind: "habitat", workRadius: 0, extent: [0, 0], terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 }, resourceSlots: [], dressing: habitat.dressing }))];
  const solids: SolidVolume[] = [];
  const sitePlacements: ResolvedWorldSiteDressing[] = [];
  for (const setting of settings) {
    if (!setting.dressing.length) continue;
    const settingScene = terrainAt(setting.centre[0], setting.centre[1]);
    const dressing = await buildWorldSiteDressing(settingScene, assets, setting);
    solids.push(...dressing.solids); sitePlacements.push(...dressing.placements);
    if (setting.cutFace) { const cut = await buildMineCutFace(settingScene, assets, setting, built.entities); solids.push(...cut.solids); }
  }
  const fairyDressing = resolveFairyDressing(fairyScene);
  solids.push(...fairyDressing.solids);
  const allSolids = [...built.solids, ...solids];
  const spec = buildDungeonSpec(scene); const dungeon = spec ? buildDungeon(spec, scene.materials) : null;
  const structures = await buildStructureNavigationSources(assets, built.entities);
  const meshes = [...dryNavigationMeshes(scene.getWalkableMeshes(), scene.getWaterBodies()).meshes, ...fairyScene.getWalkableMeshes(), ...(dungeon?.walkable ?? []), ...dungeonNavigationBlockers(dungeon?.blockers ?? []), ...structures.meshes, ...solidObstacleMeshes(allSolids)];
  const nav = new Navigation(); if (!nav.build(meshes)) throw new Error("Authored reference world navigation failed");
  // The scatter reads the global exclusion zones. Habitat clearances are left out on purpose: they follow the
  // live catalog, reject a finished trunk without touching any other placement, and so are applied at boot.
  registerExclusions(scene, allSolids, sitePlacements, fairyScene);
  const trees: ForestTreeDescriptor[] = [];
  for (const mapScene of [scene, fairyScene]) for (const tile of scatterTilesForBounds(mapScene.getScatterBounds(Infinity)))
    await scatterWorldTile(mapScene, assets, seed, tile, mapScene === fairyScene ? fairyDressing.specs : DEFAULT_SCATTER, { semanticTreesOnly: true, onTree: tree => { trees.push(tree); } });
  const structureBounds = structures.meshes.map(mesh => { const box = new Box3().setFromObject(mesh).expandByScalar(.35); return { min: box.min.toArray(), max: box.max.toArray() }; });
  return { nav, solids, structureBounds, trees };
}

/** Everything the server world pack holds, for the given seeds, pinned to `revision`. */
export async function bakeServerWorldPack(seeds: readonly number[], revision: string, assetsDirectory = "game/public/assets"): Promise<ServerWorldPack> {
  if (seeds.length === 0) throw new Error("A server world pack needs at least one seed");
  const worlds = new Map<number, PackedSeedWorld>();
  let assets: ServerWorldPack["assets"] = {};
  for (const seed of seeds) {
    const source = await openAuthoredSource(seed, assetsDirectory);
    const semantic = buildAuthoredSemantic(seed, source.terrains, source.measurements);
    const geometry = await buildAuthoredGeometry(seed, source, semantic);
    assets = Object.fromEntries(source.assets.getManifest().assets.map(entry => [entry.id, { size: entry.size, ...(entry.base ? { base: entry.base } : {}), ...(entry.groundY !== undefined ? { groundY: entry.groundY } : {}) }]));
    worlds.set(seed, { terrain: { main: source.scene.terrainSamplerData(), fairy: source.fairyScene.terrainSamplerData() }, solids: [...geometry.solids], structureBounds: [...geometry.structureBounds], trees: [...geometry.trees], nav: geometry.nav.exportNavData() });
  }
  return { formatVersion: SERVER_WORLD_PACK_VERSION, revision, seeds: [...seeds], assets, worlds };
}
