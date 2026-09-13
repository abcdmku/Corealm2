import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { CREATURE_SPECIES } from "../../../game/src/content/creatureSpecies.js";
import { ENEMIES } from "../../../game/src/content/enemies.js";
import { REGIONS } from "../../../game/src/content/regions.js";
import { RPG_BESTIARY } from "../../../game/src/content/rpgBestiary.js";
import type { AssetManifest } from "../../../game/src/render/assets.js";
import { ALL_PROCEDURAL_GEAR_ASSETS } from "../../../game/src/render/proceduralGear.js";
import { createInitialState } from "../../../game/src/state/store.js";
import { TRAVERSAL_CONTACTS } from "../../../game/src/systems/traversalContacts.js";
import { buildWorld } from "../../../game/src/world/regionBuilder.js";
import type { ReferencePools } from "../../../tools/content/references.js";
import { gameRoot } from "../../../tools/lib/paths.js";

/**
 * Transitional pools for authored world and creature collections that still live in TypeScript.
 * Mutable JSON pools are built by validateCollections from its locked disk snapshot instead.
 * Manifest dimensions and public audio paths are reread on every call, including after promotion.
 */
export async function readDevdocsReferencePools(): Promise<ReferencePools> {
  const publicRoot = path.join(gameRoot, "public");
  const [manifestText, audioFiles] = await Promise.all([
    readFile(path.join(publicRoot, "assets", "manifest.json"), "utf8"),
    readdir(path.join(publicRoot, "audio"), { recursive: true, withFileTypes: true }),
  ]);
  const manifest = JSON.parse(manifestText) as AssetManifest;
  const assets = new Map(manifest.assets.map(asset => [asset.id, asset]));
  const knownAssets = new Set([
    ...assets.keys(),
    ...ALL_PROCEDURAL_GEAR_ASSETS.map(asset => asset.assetId),
    ...Object.values(TRAVERSAL_CONTACTS).map(asset => asset.assetId),
    ...audioFiles.filter(entry => entry.isFile()).map(entry =>
      path.relative(publicRoot, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/")),
  ]);

  // Match validate-game-content.ts: default production seed, flat ground, real manifest dimensions.
  // The production builder resolves authored blocks directly and needs no content.register call.
  const heightAt = (): number => 0;
  const world = buildWorld(createInitialState().meta.seed, heightAt, {
    heightAt,
    baseY: id => assets.get(id)?.groundY ?? assets.get(id)?.base?.y ?? 0,
    assetSize: id => assets.get(id)?.size ?? null,
    assetCenterXZ: id => {
      const asset = assets.get(id);
      return asset?.base ? { x: asset.base.x + asset.size.x / 2, z: asset.base.z + asset.size.z / 2 } : null;
    },
  });
  const stations = REGIONS.flatMap(region => [...region.settlement?.stations ?? [], ...region.stations]);
  return {
    asset: knownAssets,
    entity: new Set(world.entities.map(entity => entity.id)),
    location: new Set(world.routeNodes.map(node => node.id)),
    settlement: new Set(REGIONS.flatMap(region => region.settlement ? [region.settlement.id] : [])),
    region: new Set(REGIONS.flatMap(region => [region.id, ...region.dungeon ? [region.dungeon.id] : []])),
    enemy: new Set(ENEMIES.map(enemy => enemy.id)),
    enemyFamily: new Set(ENEMIES.map(enemy => enemy.family)),
    species: new Set([...CREATURE_SPECIES, ...RPG_BESTIARY].map(species => species.id)),
    // Recipe references name categories. Authored station IDs are useful to world forms too.
    station: new Set(["campfire", ...stations.flatMap(station => [station.id, station.kind])]),
    resourceCluster: new Set(REGIONS.flatMap(region => region.clusters.map(cluster => cluster.id))),
  };
}
