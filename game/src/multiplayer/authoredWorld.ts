import { buildFairyTerrainSpec } from "../app/worldSpec.js";
import { resolveFairyDressing } from "../app/fairyDressing.js";
import { worldExclusions } from "../world/scatter.js";
import { prepareMobSpawns } from "../app/mobSpawns.js";
import { activatedRegionalPackIds, REGIONAL_PACK_ACTIVATION } from "../content/regionalPackActivation.js";
import { createRpgRegionalPackCatalogue } from "../content/rpgRegionalPacks.js";
import { assembleRegionalPack } from "../world/regionalPackEntities.js";
import { buildRegionalPackDressing } from "../world/regionalPackDressing.js";
import { coastalBodyOnSafeGround } from "../content/coastalEncounterFormation.js";
import { lavaObstacles } from "../world/lavaObstacles.js";
import { Box3, Scene } from "three";
import type { RegionId, Vec3 } from "../contracts.js";
import { GAME_BOOT_PROFILE } from "../app/bootProfile.js";
import { buildDungeonSpec } from "../app/dungeonSpec.js";
import { prepareWorldSurface } from "../app/worldSurface.js";
import { coastalSpawnSites } from "../app/coastalSpawns.js";
import { fishingSiteAnchors } from "../app/fishingAccess.js";
import { miningAccessPositions } from "../app/miningAccess.js";
import { WORLD_SITES, type WorldSite } from "../content/worldSites.js";
import { WORLD_HABITATS } from "../content/worldHabitats.js";
import { WorldScene } from "../render/scene.js";
import { buildDungeon, dungeonFloorHeight, chamberFloorAt, dungeonNavigationBlockers } from "../render/dungeon.js";
import { buildStructureNavigationSources } from "../render/structureNavigation.js";
import { buildWorldSiteDressing } from "../render/worldSiteDressing.js";
import { buildMineCutFace } from "../render/mineCutFace.js";
import { dryNavigationMeshes } from "../world/waterNavigation.js";
import { Navigation, solidObstacleMeshes } from "../systems/navigation.js";
import { Solids } from "../systems/solids.js";
import { NodeGeometryAssets } from "./nodeGeometryAssets.js";
import type { HeadlessWorldPorts } from "./headlessWorld.js";
import { registerExclusions } from "../app/worldExclusions.js";
import { registerHabitatClearances } from "../app/habitatClearances.js";
import { DEFAULT_SCATTER, scatterTilesForBounds, scatterWorldTile } from "../world/scatter.js";
import { ForestResources, type ForestTreeDescriptor } from "../world/forestResources.js";
import { ForestObstacles } from "../world/forestObstacles.js";
import { authoredThresholds, DungeonDoors } from "../world/dungeonDoors.js";
import { REGIONS } from "../content/regions.js";

/** Production authored geometry preparation. No renderer, canvas, textures, or browser session. */
export async function createAuthoredWorld(seed:number, assetsDirectory="game/public/assets"):Promise<HeadlessWorldPorts>{
  await Navigation.initLibrary();
  const assets=await NodeGeometryAssets.open(assetsDirectory);
  const scene=new WorldScene(new Scene());
  const terrain = GAME_BOOT_PROFILE.terrain();
  scene.buildWorld(terrain,prepared=>prepareWorldSurface(prepared,seed));
  const fairyScene = new WorldScene(new Scene());
  fairyScene.buildWorld(buildFairyTerrainSpec(), prepared => prepareWorldSurface(prepared, seed));
  const fairyBounds = fairyScene.getScatterBounds(Infinity);
  const terrainAt = (x: number, z: number) => x >= fairyBounds.minX && x <= fairyBounds.maxX
    && z >= fairyBounds.minZ && z <= fairyBounds.maxZ ? fairyScene : scene;
  const heightAt=(region:RegionId,x:number,z:number)=>terrainAt(x,z).heightAt(region,x,z);
  const roadPolylines=[...scene.getRoadPolylines(), ...fairyScene.getRoadPolylines()];
  const roadDistance=(x:number,z:number)=>{
    let best=Infinity;
    for(const line of roadPolylines)for(let i=0;i<line.length-1;i++){
      const a=line[i]!,b=line[i+1]!;const dx=b[0]-a[0],dz=b[2]-a[2];
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz||1)));
      best=Math.min(best,Math.hypot(x-a[0]-t*dx,z-a[2]-t*dz));
    }return best;
  };
  const measurements={baseY:(id:string)=>assets.baseY(id),assetSize:(id:string)=>assets.assetSize(id),assetCenterXZ:(id:string)=>assets.assetCenterXZ(id)};
  const fishing = fishingSiteAnchors(WORLD_SITES, scene.getWaterBodies(), (x,z) => terrainAt(x,z).meshHeightAt(x,z));
  const catalogue = createRpgRegionalPackCatalogue(id => {
    const entry = assets.entry(id); return entry?.base ? {size:entry.size,base:entry.base} : null;
  }, activatedRegionalPackIds(), REGIONAL_PACK_ACTIVATION.assignmentOverrides);
  const built=GAME_BOOT_PROFILE.buildSemanticWorld(seed,heightAt,{...measurements,heightAt,roadDistance,dungeonGates:true,
    accessPositions:new Map([...fishing.banks,
      ...miningAccessPositions(WORLD_SITES,(x,z)=>terrainAt(x,z).meshHeightAt(x,z),measurements)]),coastalSpawns:coastalSpawnSites(scene,seed), fishingSchools:fishing.schools,
    minibossCanStand:(region,x,z)=>{const sample=terrainAt(x,z).sampleWorld(x,z);return sample.playable&&sample.semanticRegion===region&&sample.waterBodyId===null&&sample.slope!==null&&sample.slope<=.5;},
    coastalAccepts:(spot,radius)=>coastalBodyOnSafeGround((x,z)=>terrainAt(x,z).sampleWorld(x,z),spot,radius)});
  built.entities.push(...catalogue.packs.flatMap(pack => assembleRegionalPack(pack.id,
    {...measurements,heightAt:(x,z)=>terrainAt(x,z).meshHeightAt(x,z)}, {seed}, catalogue).entities));
  if (terrain.lavaChannels?.length) built.solids.push(...lavaObstacles(terrain.lavaChannels,(x,z)=>terrainAt(x,z).meshHeightAt(x,z)));
  let habitats = [...WORLD_HABITATS, ...catalogue.habitats, ...(built.coastalHabitats ?? [])];
  const packHabitats = new Map([...catalogue.habitats, ...(built.coastalHabitats ?? [])].map(h => [h.groupId,h]));
  const encounterNavSolids = new Map<string, import("../contracts.js").SolidVolume>();
  const settings:WorldSite[]=[...WORLD_SITES,...habitats.map((habitat):WorldSite=>({id:habitat.id,locationId:habitat.groupId,regionId:habitat.regionId,
    centre:[0,0],rotationY:0,kind:"habitat",workRadius:0,extent:[0,0],terrain:{floorRadius:0,backRise:0,backDistance:0,bermWidth:0,approachAngle:0},resourceSlots:[],dressing:habitat.dressing}))];
  const sitePlacements:import("../render/worldSiteDressing.js").ResolvedWorldSiteDressing[]=[];
  for(const setting of settings){
    if(!setting.dressing.length)continue;
    const habitat = packHabitats.get(setting.locationId);
    const settingScene = terrainAt(setting.centre[0],setting.centre[1]);
    const dressing = habitat ? await buildRegionalPackDressing(settingScene, assets, habitat,
      Math.max(0,...built.entities.filter(e=>e.meta?.groupId===habitat.groupId).map(e=>e.combat?.bodyRadius??0)))
      : await buildWorldSiteDressing(settingScene,assets,setting);
    if ("navigationSolids" in dressing) for (const solid of dressing.navigationSolids as import("../contracts.js").SolidVolume[]) encounterNavSolids.set(solid.id,solid);
built.solids.push(...dressing.solids);sitePlacements.push(...dressing.placements);
    if(setting.cutFace){const cut=await buildMineCutFace(settingScene,assets,setting,built.entities);built.solids.push(...cut.solids);}
  }
  const fairyDressing = resolveFairyDressing(fairyScene);
  built.solids.push(...fairyDressing.solids);
  const spec=buildDungeonSpec(scene);const dungeon=spec?buildDungeon(spec,scene.materials):null;
  const dungeonRegion=REGIONS.find(region=>region.dungeon);
  const thresholds=dungeonRegion?.dungeon?authoredThresholds(dungeonRegion.dungeon,heightAt(dungeonRegion.id,...dungeonRegion.dungeon.entrance)):[];
  const doorBarriers=thresholds.map(threshold=>threshold.barrier);
  const structures=await buildStructureNavigationSources(assets,built.entities);
  const meshes=[...dryNavigationMeshes(scene.getWalkableMeshes(),scene.getWaterBodies()).meshes,...fairyScene.getWalkableMeshes(),...(dungeon?.walkable??[]),...dungeonNavigationBlockers(dungeon?.blockers??[]),...structures.meshes,...solidObstacleMeshes(built.solids.map(solid=>encounterNavSolids.get(solid.id)??solid))];
  const nav=new Navigation();if(!nav.build(meshes))throw new Error("Authored reference world navigation failed");
  nav.setRouteGraph(built.routeNodes,built.routeEdges);
  const doors=new DungeonDoors(doorBarriers,id=>built.entities.find(entity=>entity.id===id));
  nav.setPathConstraint(path=>doors.clipPath(path));
  habitats = prepareMobSpawns(built.entities, habitats, {solids:built.solids,scene,nav,dungeonSpec:spec,doorThresholds:thresholds,profile:GAME_BOOT_PROFILE,assetSize:measurements.assetSize,terrainAt});
  registerExclusions(scene,built.solids,sitePlacements,fairyScene);
  registerHabitatClearances(nav,built.entities,habitats.filter(h=>h.regionId!==spec?.regionId));
  const trees:ForestTreeDescriptor[]=[];
  for(const mapScene of [scene,fairyScene])for(const tile of scatterTilesForBounds(mapScene.getScatterBounds(Infinity)))
    await scatterWorldTile(mapScene,assets,seed,tile,mapScene===fairyScene?fairyDressing.specs:DEFAULT_SCATTER,{semanticTreesOnly:true,onTree:tree=>{
      if(!worldExclusions.blocksTreeClearance(tree.position[0],tree.position[2],tree.trunkRadius))trees.push(tree);
    }});
  const forestObstacles=new ForestObstacles();let forest:ForestResources;
  const solids=new Solids(built.solids);const structureBounds=structures.meshes.map(mesh=>new Box3().setFromObject(mesh).expandByScalar(.35));
  const spawn=GAME_BOOT_PROFILE.spawn;const point:Vec3=[spawn.x,heightAt(spawn.regionId,spawn.x,spawn.z),spawn.z];
  const playable=(region:RegionId,position:Vec3)=>spec&&region===spec.regionId?chamberFloorAt(spec,position)!==null:
    terrainAt(position[0],position[2]).sampleWorld(position[0],position[2]).playable&&terrainAt(position[0],position[2]).regionAt(position[0],position[2])===region;
  return {nav,enemies:catalogue.variants.map(v=>v.stats),habitats,entities:built.entities,knownLocations:built.knownLocations,doorBarriers,spawn:nav.closestPoint(point)??point,
    initialize(world){
      forest=new ForestResources({entities:world.entities,getNodeState:id=>world.shared.nodes[id],onActivate:tree=>{if(world.shared.nodes[tree.id]?.state!=="depleted")forestObstacles.upsert(tree);},onDeactivate:tree=>{forestObstacles.remove(tree.id);}});
      for(const tree of trees){world.entities.remove(tree.id);forest.register(tree);}
    },
    beforeTick(world){
      const players=[...world.active].map(id=>world.players.get(id)!.store.get());const pins=new Set<string>();
      for(const player of players){if(player.player.movement.destinationEntityId)pins.add(player.player.movement.destinationEntityId);if(player.activity?.kind==="gathering")pins.add(player.activity.entityId);}
      forest.updatePlayers(players.map(player=>player.player.position),pins);
      forest.forEachResident((entity,tree)=>{if(entity.state==="depleted")forestObstacles.remove(tree.id);else forestObstacles.upsert(tree);});
    },
    movement:{solids,authoritativeGround:true,heightAt:(region,x,z)=>spec&&region===spec.regionId?dungeonFloorHeight(spec,x,z):heightAt(region,x,z),dynamicObstacles:forestObstacles,preserveNavigationHeight:point=>structureBounds.some(box=>point[0]>=box.min.x&&point[0]<=box.max.x&&point[1]>=box.min.y&&point[1]<=box.max.y&&point[2]>=box.min.z&&point[2]<=box.max.z),
      regionAt:(point,current)=>current===spec?.regionId?current:terrainAt(point[0],point[2]).regionAt(point[0],point[2])},
    campfirePlacement:{withinPlayableBounds:playable,
      groundAt:(region,x,z)=>{
        if(spec&&region===spec.regionId){const y=dungeonFloorHeight(spec,x,z);return chamberFloorAt(spec,[x,y,z])!==null?{y,normal:[0,1,0]}:null;}
        const sample=terrainAt(x,z).sampleWorld(x,z);return sample.playable&&sample.semanticRegion===region&&!sample.waterBodyId?{y:terrainAt(x,z).meshHeightAt(x,z),normal:terrainAt(x,z).normalAt(x,z)}:null;
      },
      distanceToWater:(region,point)=>{
        if(region===spec?.regionId)return Infinity;
        for(const radius of [0,.2,.4,.6,.8,1])for(let i=0;i<(radius===0?1:32);i++){
          const sample=terrainAt(point[0],point[2]).sampleWorld(point[0]+Math.sin(i*Math.PI/16)*radius,point[2]+Math.cos(i*Math.PI/16)*radius);
          if(!sample.playable||sample.waterBodyId)return radius;
        }return 1.001;
      },clearAt:(_region,point,radius)=>{const resolved=solids.resolve(point,point,radius);return Math.hypot(point[0]-resolved[0],point[2]-resolved[2])<.001;},
    }};
}
