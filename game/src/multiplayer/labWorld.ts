import { FEATURE_LAB_BOOT_PROFILE } from "../app/bootProfile.js";
import type { SemanticEntity, Vec3 } from "../contracts.js";
import { REGIONS } from "../content/regions.js";
import { resourceDef, RESOURCES } from "../content/resources.js";
import { respawnSeconds, yieldRange } from "../content/index.js";
import { Rng } from "../core/rng.js";
import { Navigation } from "../systems/navigation.js";
import { Solids } from "../systems/solids.js";
import { buildEnemyGroup } from "../world/regionBuilder.js";
import type { HeadlessWorldPorts } from "./headlessWorld.js";
import { TRAVERSAL_CONTACTS } from "../systems/traversalContacts.js";
import { ENEMIES } from "../content/enemies.js";

/** Shared semantic fixture for the server and persistent production lab. */
export function multiplayerLabEntities(seed = 1337): SemanticEntity[] {
  const built = FEATURE_LAB_BOOT_PROFILE.buildSemanticWorld(seed, () => 0);
  const resource = resourceDef("ore_grithe");
  const maxYields = yieldRange(resource.tier)[0];
  built.entities.push({
    id: "multiplayer:ore", archetype: "ore", name: resource.name, tier: resource.tier,
    regionId: "fallowmarch", position: [6, 0, 0], state: "available", interactions: ["inspect", "mine"],
    requirements: { mining: resource.reqLevel },
    resource: { itemId: resource.itemId, remaining: maxYields, maxYields, respawnSeconds: respawnSeconds(resource.tier) },
    view: { assetId: "corealm_ore_grithe", scale: 1 },
  });
  for (const [id, resource, position, interaction] of [
    ["multiplayer:tree", RESOURCES.find(r=>r.archetype==="tree"&&r.tier===1)!, [-6,0,0], "chop"],
    ["multiplayer:fish", resourceDef("fish_silt_minnow"), [-6,0,-6], "fish"],
  ] as const) {
    const yields=(resource.yieldRange??yieldRange(resource.tier))[0];
    built.entities.push({id,name:resource.name,archetype:resource.archetype,tier:resource.tier,regionId:"fallowmarch",position,
      state:"available",interactions:["inspect",interaction],requirements:{[resource.skill]:resource.reqLevel},
      resource:{itemId:resource.itemId,remaining:yields,maxYields:yields,respawnSeconds:resource.respawnSeconds??respawnSeconds(resource.tier)},
      view:{assetId:resource.presentation.availableAssetIds[0]!,scale:resource.archetype==="tree"?.7:.4}});
  }
  built.entities.push({id:"multiplayer:range",name:"Lab cooking station",archetype:"station",tier:1,regionId:"fallowmarch",
    position:[-3,0,0],state:"available",interactions:["inspect","produce"],station:{kind:"range",skill:"cooking",recipeIds:["cook_seared_minnow"]},
    view:{assetId:"crate_wood",scale:1}});
  for (const [index, [kind, contact]] of Object.entries(TRAVERSAL_CONTACTS).entries()) {
    const x = -12 + index * 6;
    built.entities.push({id:`multiplayer:${kind}`,name:`Lab ${kind}`,archetype:"obstacle",tier:1,regionId:"fallowmarch",
      position:[x,0,14],interactionPosition:[x,0,11.8],state:"available",interactions:["inspect",kind==="vault"?"vault":"climb"],
      obstacle:{reqLevel:1,exitPosition:[x,0,16.2],durationMs:contact.durationMs,savesMeters:4},
      meta:{traversalKind:kind,traversalContactDepth:contact.depth,traversalContactWidth:contact.width,traversalRise:contact.rise},
      view:{assetId:contact.assetId}});
  }
  built.entities.push({id:"multiplayer:shop",name:"Lab general supplies",archetype:"shop",tier:1,regionId:"fallowmarch",
    position:[-10,0,5],state:"available",interactions:["inspect","trade"],meta:{shopId:"coldbrace_general"},view:{assetId:"crate_wood"}},
    {id:"multiplayer:npc",name:"Warden Ilse",archetype:"npc",tier:1,regionId:"fallowmarch",position:[-10,0,8],
      state:"alive",interactions:["inspect","talk"],npc:{dialogueRootId:"ilse_root",questIds:[]},view:{assetId:"base_female"}},
    {id:"multiplayer:portal",name:"Lab passage",archetype:"portal",tier:1,regionId:"fallowmarch",position:[-14,0,5],
      state:"available",interactions:["inspect","enter"],meta:{toLocationId:"multiplayer:arrival"},view:{assetId:"chest_wood"}});
  const frog = REGIONS[0]!.enemyGroups.find((group) => group.family === "frog")!;
  buildEnemyGroup("fallowmarch", { ...frog, id: "multiplayer:frog", count: 1, legacyCount: 1, centre: [12, 0], radius: 0 },
    new Rng(seed), (spot) => [spot[0], 0, spot[1]], built.entities, () => null);
  const caster=ENEMIES.find(enemy=>enemy.attackStyle==="magic")!;
  buildEnemyGroup("fallowmarch",{...frog,id:"multiplayer:caster",family:caster.family,tier:caster.tier,count:1,legacyCount:1,centre:[26,-12],radius:0},
    new Rng(seed),spot=>[spot[0],0,spot[1]],built.entities,()=>null);
  built.entities.push({id:"multiplayer:passage",name:"Lab covered passage",archetype:"obstacle",tier:1,regionId:"fallowmarch",
    position:[0,0,22],state:"available",interactions:["inspect","enter"],obstacle:{reqLevel:1,exitPosition:[12,0,22],durationMs:2000,savesMeters:12},
    meta:{traversalKind:"passage"},view:{assetId:"chest_wood"}});
  return built.entities;
}

/** The lab's flat central production build pad, with real Recast navigation and collision. */
export async function createMultiplayerLabWorld(seed = 1337): Promise<HeadlessWorldPorts> {
  await Navigation.initLibrary();
  // A flat 96 m square, two triangles facing up. Written as triangles so the server loads no renderer for it.
  const nav = new Navigation();
  if (!nav.buildFromTriangles({ positions: new Float32Array([-48, 0, -48, 48, 0, -48, -48, 0, 48, 48, 0, 48]), indices: new Uint32Array([0, 2, 1, 2, 3, 1]) }))
    throw new Error("Multiplayer lab navigation failed");
  nav.setRouteGraph([{id:"multiplayer:arrival",name:"Lab arrival",regionId:"fallowmarch",position:[14,0,5]}],[]);
  const entities = multiplayerLabEntities(seed);
  const solids = new Solids([]);
  return { nav, entities, spawn: [0, 0, 0] as Vec3,
    // The pad's creatures are placed by this fixture, not by placements, so a publish has no group to rebuild here.
    planSpawns: () => ({ groupIds: new Set<string>(), spawns: [], habitats: [] }),
    movement: { solids, heightAt: () => 0, regionAt: () => "fallowmarch" },
    campfirePlacement: {
      groundAt: (_region, x, z) => Math.abs(x) < 47 && Math.abs(z) < 47 ? { y: 0, normal: [0, 1, 0] } : null,
      withinPlayableBounds: (_region, point) => Math.abs(point[0]) < 47 && Math.abs(point[2]) < 47,
      distanceToWater: () => Infinity,
      clearAt: (_region, point, radius) => entities.every((entity) => Math.hypot(entity.position[0] - point[0], entity.position[2] - point[2]) > radius),
    } };
}
