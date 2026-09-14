import { readFileSync, writeFileSync } from 'node:fs';
const snapshot=JSON.parse(readFileSync('runs/devdocs/world-migration/snapshot.json','utf8'));
const sourceCreatures=JSON.parse(readFileSync('game/content/data/creatures.json','utf8'));
const enemies=JSON.parse(readFileSync('game/content/data/enemies.json','utf8'));
const aliases=JSON.parse(readFileSync('game/content/data/enemyAliases.json','utf8'));
const encounters=new Map(), placements=[], resources=[];
for(const {regionId,group:g,habitat:h,enemyId,bodyRadius} of snapshot.groups){
 if(!enemyId) throw Error('No combat id '+g.id);
 const activity=h?.activity??'patrol'; const encounterId=`${enemyId}_${activity}`;
 encounters.set(encounterId,{id:encounterId,name:g.name,activity,members:[{creatureId:enemyId,weight:1}]});
 const centre=h?.centre??g.centre;
 const anchors=h?.anchors?.slice(0,g.count)??[g.centre];
 placements.push({id:g.id,encounterId,regionId,centre,count:g.count,radius:Math.max(h?.radius??g.radius,bodyRadius+.01),
 formation:{kind:'authored',spacing:bodyRadius*2+.5,rotation:0},
 anchorAdjustments:anchors.map((a,index)=>({index,offset:[a[0]-centre[0],a[1]-centre[1]]})),
 dressing:h?.dressing??[],...(h?.roamRadius!==undefined?{roamRadius:h.roamRadius}:{}),...(h?.boundary?{boundary:h.boundary}:{}),
 ...(h?.id?{habitatId:h.id}:{}),...((g.legacyCount??g.count)===1?{firstActorUsesPlacementId:true}:{})});
}
function geometry(r){ const {enemyGroups,clusters,dungeon,...rest}=r; for(const c of clusters??[]) resources.push({...c,regionId:r.id}); return {...rest,...(dungeon?{dungeon:geometry(dungeon)}:{})}; }
const regions=snapshot.regions.map(geometry);
for(const [name,data] of Object.entries({encounters:[...encounters.values()],placements,resourcePlacements:resources,worldRegions:regions}))writeFileSync(`game/content/data/${name}.json`,JSON.stringify(data,null,2)+'\n');
console.log(`Migrated ${encounters.size} encounters, ${placements.length} placements and ${resources.length} resource placements.`);
