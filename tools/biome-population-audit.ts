import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { REGIONS, SOURCE_REGIONS } from '../game/src/content/regions.js';
import { activatedRegionalPackIds, REGIONAL_PACK_ACTIVATION } from '../game/src/content/regionalPackActivation.js';
import { REGIONAL_PACKS } from '../game/src/content/regionalPacks.js';
import { Scene } from 'three';
import { WorldScene } from '../game/src/render/scene.js';
import { buildWorldTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { WORLD_HABITATS } from '../game/src/content/worldHabitats.js';
import { WORLD_SITES } from '../game/src/content/worldSites.js';
import { inStarterWildlifeArea, isStarterAnimalAsset } from '../game/src/content/fantasyEncounters.js';
import { BIOME_POPULATION, BIOME_POPULATION_HABITATS, BIOME_POPULATION_LEGACY_REPLACEMENTS } from '../game/src/content/biomePopulation.js';
import type { Spot } from '../game/src/content/regions.js';
import { createRpgRegionalPackCatalogue } from '../game/src/content/rpgRegionalPacks.js';
import { coastalSpawnSites } from '../game/src/app/coastalSpawns.js';
import { buildWorld } from '../game/src/world/regionBuilder.js';
import { GameDriver, FAST_TEST_SETTINGS } from './lib/driver.js';
import { startGameServer } from './lib/server.js';
import { tierSilhouetteScale } from '../game/src/core/math.js';
import { CREATURE_SPECIES } from '../game/src/content/creatureSpecies.js';
import { RPG_BESTIARY } from '../game/src/content/rpgBestiary.js';

const activeIds = new Set(activatedRegionalPackIds());
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const assets = new Map<string, { id: string; size: {x:number;y:number;z:number}; base: {x:number;y:number;z:number} }>(manifest.assets.map((row:any)=>[row.id,row]));
const activeCatalogue = createRpgRegionalPackCatalogue(id=>assets.get(id)??null,[...activeIds],REGIONAL_PACK_ACTIVATION.assignmentOverrides);
const census = REGIONS.map(region => ({
  regionId: region.id,
  groups: region.enemyGroups.map(group => ({ id: group.id, assetId: group.assetId, count: group.count, centre: group.centre, radius: group.radius })),
  dungeon: region.dungeon ? { id: region.dungeon.id, groups: region.dungeon.enemyGroups } : undefined,
  activeRegional: activeCatalogue.packs.filter(pack => pack.regionId === region.id)
    .map(pack => ({ id: pack.id, assetId:pack.assetId, count: pack.members.length, centre: pack.centre, radius: pack.radius })),
}));
await mkdir('test-results/biome-population', { recursive: true });
await writeFile('test-results/biome-population/census.json', JSON.stringify(census, null, 2));
const populationIds=new Set(BIOME_POPULATION.map(pack=>pack.id));
const counts=census.map(row=>({regionId:row.regionId,
  existingSurface:row.groups.filter(group=>!populationIds.has(group.id)).reduce((sum,group)=>sum+group.count,0),
  activeRegional:row.activeRegional.reduce((sum,group)=>sum+group.count,0),
  addedGroups:BIOME_POPULATION.filter(pack=>pack.regionId===row.regionId).length,
  addedResidents:BIOME_POPULATION.filter(pack=>pack.regionId===row.regionId).reduce((sum,pack)=>sum+pack.count,0),
}));
console.log(JSON.stringify(counts,null,2));

type Reservation = { id: string; gap: (point: Spot) => number };
function segmentDistance(point: Spot, a: Spot, b: Spot): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], squared = dx * dx + dz * dz;
  const t = squared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / squared)) : 0;
  return Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t);
}
function disc(id: string, centre: Spot, radius: number): Reservation {
  return {id, gap: point => Math.hypot(point[0] - centre[0], point[1] - centre[1]) - radius};
}
function box(id: string, centre: Spot, half: Spot, yaw=0): Reservation {
  return {id, gap: point => { const x=point[0]-centre[0], z=point[1]-centre[1];
    return Math.hypot(Math.max(0, Math.abs(x*Math.cos(yaw)-z*Math.sin(yaw))-half[0]),
      Math.max(0, Math.abs(x*Math.sin(yaw)+z*Math.cos(yaw))-half[1])); }};
}

const scene = new WorldScene(new Scene());
scene.buildWorld(buildWorldTerrainSpec(), prepareWorldSurface);
const newIds = new Set(BIOME_POPULATION.map(row => row.id));
const existing = [
  ...WORLD_HABITATS.filter(row => !newIds.has(row.groupId)).map(row => disc(row.groupId, row.centre, row.radius+3.5)),
  ...REGIONS.flatMap(region => region.enemyGroups).filter(group => !newIds.has(group.id) && !WORLD_HABITATS.some(habitat=>habitat.groupId===group.id))
    .map(group => disc(group.id, group.centre, Math.max(group.radius, group.boss || group.miniBoss ? 24 : 10)+3.5)),
  ...REGIONAL_PACKS.filter(pack=>activeIds.has(pack.id)).map(pack=>disc(pack.id,pack.centre,pack.radius+1)),
];
const reservations: Reservation[] = [
  ...existing,
  ...WORLD_SITES.map(site=>box(site.id,site.centre,[site.extent[0]+5,site.extent[1]+5],site.rotationY)),
  ...REGIONS.flatMap(region=>[
    ...region.locations.map(location=>disc(location.id,location.position,7)),
    ...region.clusters.map(cluster=>disc(cluster.id,cluster.centre,cluster.radius+4)),
    ...region.landmarks.map(landmark=>disc(landmark.id,landmark.position,18)),
    ...(region.settlement ? [disc(region.settlement.id,region.settlement.centre,
      Math.max(...region.settlement.buildings.map(building=>Math.hypot(building.position[0]-region.settlement!.centre[0],building.position[1]-region.settlement!.centre[1])+Math.hypot(...building.footprint)/2))+5)] : []),
  ]),
  box('black_knight_castle',[40,600],[25,28]),
  box('northern_lava_reserve',[182.5,670],[67.5,35]),
  box('broken_watch_ruin',[-250,520],[13,12]), box('abbey_ruin',[-130,610],[16,19]),
  box('smithy_ruin',[130,565],[17,13]), box('aqueduct_ruin',[-205,665],[23,10]),
  box('western_watch_ruin',[-310,575],[15,14]), box('northern_smithy_ruin',[-55,675],[19,15]),
  box('eastern_abbey_ruin',[305,670],[18,21]), box('eastern_aqueduct_ruin',[230,555],[25,12]),
  ...([[-305,575],[310,660],[-40,545],[5,675],[-205,585]] as const).map((point,index)=>disc(`northern_site_${index}`,point,18)),
  ...scene.getRoadPolylines().flatMap((line,index)=>line.slice(1).map((b,j)=>({id:`road_${index}_${j}`,
    gap:(point:Spot)=>segmentDistance(point,[line[j]![0],line[j]![2]],[b[0],b[2]])-8}))),
];
function screen(centre:Spot,radius:number,regionId:string) {
  const nearest=reservations.map(reserve=>({id:reserve.id,gap:reserve.gap(centre)-radius})).sort((a,b)=>a.gap-b.gap)[0]!;
  let maxSlope=0, dry=true;
  for (let x=-radius;x<=radius;x+=2.5) for(let z=-radius;z<=radius;z+=2.5) {
    if(Math.hypot(x,z)>radius)continue;
    const sample=scene.sampleWorld(centre[0]+x,centre[1]+z);
    maxSlope=Math.max(maxSlope,sample.slope??Infinity);
    dry &&= sample.playable && !sample.waterBodyId;
  }
  return {nearest,maxSlope,dry,visualBiome:scene.sampleWorld(...centre).visualBiome,
    accepted:nearest.gap>=1 && maxSlope<.65 && dry};
}
if(process.argv.includes('--propose')) {
  const selected: {regionId:string;centre:Spot;radius:number;nearest:unknown;maxSlope:number}[]=[];
  for(const region of REGIONS) {
    const target=region.id==='fallowmarch'?8:12;
    const candidates:{centre:Spot;nearest:unknown;maxSlope:number;score:number}[]=[];
    for(let x=region.bounds.min[0]+12;x<=region.bounds.max[0]-12;x+=6) {
      for(let z=region.bounds.min[1]+12;z<=region.bounds.max[1]-12;z+=6) {
        const centre=[x,z] as const;
        if(region.id==='fallowmarch' && inStarterWildlifeArea('fallowmarch',centre,-9))continue;
        if(reservations.some(reserve=>reserve.gap(centre)<10))continue;
        const result=screen(centre,9,region.id); if(!result.accepted)continue;
        candidates.push({centre,nearest:result.nearest,maxSlope:result.maxSlope,score:result.nearest.gap});
      }
    }
    for(let i=0;i<target;i++) {
      const columns=4, rows=Math.ceil(target/columns);
      const ideal:Spot=[region.bounds.min[0]+(i%columns+.5)/columns*(region.bounds.max[0]-region.bounds.min[0]),
        region.bounds.min[1]+(Math.floor(i/columns)+.5)/rows*(region.bounds.max[1]-region.bounds.min[1])];
      const merit=(candidate:typeof candidates[number])=>candidate.score<1?-Infinity:
        -Math.hypot(candidate.centre[0]-ideal[0],candidate.centre[1]-ideal[1])+Math.min(candidate.score,12)*.5;
      candidates.sort((a,b)=>merit(b)-merit(a) || a.centre[0]-b.centre[0] || a.centre[1]-b.centre[1]);
      const choice=candidates.shift(); if(!choice || choice.score<1)break;
      selected.push({regionId:region.id,centre:choice.centre,radius:9,nearest:choice.nearest,maxSlope:choice.maxSlope});
      for(const candidate of candidates)candidate.score=Math.min(candidate.score,Math.hypot(candidate.centre[0]-choice.centre[0],candidate.centre[1]-choice.centre[1])-20);
    }
  }
  await writeFile('test-results/biome-population/proposal.json',JSON.stringify(selected,null,2));
  console.log(JSON.stringify(selected,null,2));
}
if(BIOME_POPULATION.length) {
  const screened=BIOME_POPULATION.map(pack=>({id:pack.id,...screen(pack.centre,pack.radius,pack.regionId)}));
  await writeFile('test-results/biome-population/screened.json',JSON.stringify(screened,null,2));
  console.log(JSON.stringify({screened:screened.length,failed:screened.filter(row=>!row.accepted)},null,2));
  assert(screened.every(row=>row.accepted),'New population source reservations and dry terrain');
}
const speciesById=new Map([...CREATURE_SPECIES,...RPG_BESTIARY].map(species=>[species.id,species]));
const bodyEnvelopes=[...new Set(BIOME_POPULATION.map(pack=>pack.speciesId))].map(id=>{
  const species=speciesById.get(id),asset=assets.get(species?.assetId??`creature_${id}`);
  if(!species||!asset)return {id,pending:true};
  const staticRadius=Math.hypot(Math.max(Math.abs(asset.base.x),Math.abs(asset.base.x+asset.size.x)),
    Math.max(Math.abs(asset.base.z),Math.abs(asset.base.z+asset.size.z)))*species.scale*tierSilhouetteScale(Math.max(
      ...BIOME_POPULATION.filter(pack=>pack.speciesId===id).map(pack=>REGIONS.find(region=>region.id===pack.regionId)!.tier)));
  const movingRadius=staticRadius*1.2+.25;
  return {id,pending:false,staticRadius,movingRadius,accepted:movingRadius<=3.5};
});
await writeFile('test-results/biome-population/body-envelopes.json',JSON.stringify(bodyEnvelopes,null,2));
if(process.argv.includes('--require-assets')) {
  assert(bodyEnvelopes.every(row=>!row.pending),'Every population body must be promoted before world acceptance');
  assert(bodyEnvelopes.every(row=>row.accepted),'Every population body must fit its moving envelope');
}

const sourceGroups=SOURCE_REGIONS.flatMap(region=>[
  ...region.enemyGroups.map(group=>({regionId:region.id,group})),
  ...(region.dungeon?.enemyGroups.map(group=>({regionId:region.dungeon!.id,group}))??[]),
]);
const projectedGroups=REGIONS.flatMap(region=>[
  ...region.enemyGroups.map(group=>({regionId:region.id,group})),
  ...(region.dungeon?.enemyGroups.map(group=>({regionId:region.dungeon!.id,group}))??[]),
]);
const coverage=sourceGroups.filter(({group})=>!populationIds.has(group.id)).map(({regionId,group})=>{
  const current=projectedGroups.find(row=>row.group.id===group.id)!.group;
  const habitat=WORLD_HABITATS.find(row=>row.groupId===group.id);
  const centre=habitat?.centre??group.centre, radius=habitat?.radius??group.radius;
  const natural=isStarterAnimalAsset(current.assetId);
  return {regionId,id:group.id,sourceAsset:group.assetId,currentAsset:current.assetId,count:current.count,
    proposedSpecies:BIOME_POPULATION_LEGACY_REPLACEMENTS[group.id]??null,
    sourceNatural:isStarterAnimalAsset(group.assetId),currentNatural:natural,
    starter:natural&&inStarterWildlifeArea(regionId,centre,radius),
    changedBody:group.assetId!==current.assetId};
});
const coastal=coastalSpawnSites(scene,1337);
const coastalEntities=buildWorld(1337,(_region,x,z)=>scene.meshHeightAt(x,z),{
  heightAt:(_region,x,z)=>scene.meshHeightAt(x,z),baseY:id=>assets.get(id)?.base.y??0,
  assetSize:id=>assets.get(id)?.size??null,coastalSpawns:coastal,
}).entities.filter(entity=>entity.id.startsWith('coastal_'));
const leaks=coverage.filter(row=>row.currentNatural&&!row.starter);
const regionalLeaks=activeCatalogue.packs.filter(pack=>isStarterAnimalAsset(pack.assetId)
  &&!inStarterWildlifeArea(pack.regionId,pack.centre,pack.radius));
const coastalLeaks=coastalEntities.filter(entity=>isStarterAnimalAsset(entity.view?.assetId??''));
await writeFile('test-results/biome-population/coverage.json',JSON.stringify({counts,coverage,
  activeRegional:activeCatalogue.groups.map(group=>({id:group.id,assetId:group.assetId,count:group.count})),
  coast:{sites:coastal.length,residents:coastalEntities.length,assetIds:[...new Set(coastalEntities.map(entity=>entity.view?.assetId))],leaks:coastalLeaks},
  leaks,regionalLeaks},null,2));
console.log(JSON.stringify({coverage:coverage.length,changedBodies:coverage.filter(row=>row.changedBody).length,
  naturalStarter:coverage.filter(row=>row.starter).length,leaks,regionalLeaks,coastalResidents:coastalEntities.length,coastalLeaks:coastalLeaks.length},null,2));
assert.equal(leaks.length+regionalLeaks.length+coastalLeaks.length,0,'Ordinary animals remain confined to starter areas');
scene.clear();

if(process.argv.includes('--browser')) {
  const urlArg=process.argv.find(arg=>arg.startsWith('--url='));
  const server=urlArg?{url:urlArg.slice(6),close:async()=>{}}:await startGameServer();
  const driver=new GameDriver(server,{settings:FAST_TEST_SETTINGS,
    browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
  try {
    await driver.launch(); await driver.open(60000); const page=driver.page!;
    const result=await page.evaluate(habitats=>{
      const debug=window.__gameDebug as any;
      return habitats.map(habitat=>{
        const points=habitat.anchors.map(([x,z])=>[x,debug.groundHeight(x,z),z]);
        const pairs=points.flatMap((a,index)=>points.slice(index+1).map(b=>[a,b] as const));
        return {id:habitat.groupId,anchors:habitat.anchors,
          samples:points.map(point=>debug.sampleWorld(point[0],point[2])),
          paths:pairs.map(([a,b])=>({from:a,to:b,path:debug.getNavPath(a,b)}))};
      });
    },BIOME_POPULATION_HABITATS);
    const failures:string[]=[];
    for(const row of result) {
      for(const sample of row.samples) if(!sample.playable||sample.waterBodyId)failures.push(`${row.id}: wet anchor`);
      for(const pair of row.paths) {
        const end=pair.path?.at(-1);
        if(!end||Math.hypot(end.x-pair.to[0]!,end.z-pair.to[2]!)>.75)failures.push(`${row.id}: incomplete path`);
      }
    }
    const errors=await page.evaluate(()=>(window.__gameDebug as any).getErrors());
    await writeFile('test-results/biome-population/navigation.json',JSON.stringify({result,failures,errors,
      browserErrors:[...driver.pageErrors,...driver.consoleErrors]},null,2));
    console.log(JSON.stringify({navigationHabitats:result.length,paths:result.reduce((sum,row)=>sum+row.paths.length,0),failures},null,2));
    assert.deepEqual(failures,[]); assert.deepEqual(errors,[]);
    assert.deepEqual(driver.pageErrors,[]);assert.deepEqual(driver.consoleErrors,[]);
  } finally {await driver.close();await server.close();}
}
