import { readFileSync } from 'node:fs';

// Root approved the 28 joint estimates and subsequent weighted geometry review.
// Zombie Run is usable only after the explicit source Walk alias is present.
const measurements = JSON.parse(readFileSync(new URL('./gait-results.json', import.meta.url), 'utf8'));
const spider = JSON.parse(readFileSync(new URL('./replacement-inventory/spider-gait.json', import.meta.url), 'utf8'));
const completeSources = JSON.parse(readFileSync(new URL('./replacement-inventory/complete-source-gaits.json', import.meta.url), 'utf8')).results;
const userGolems = JSON.parse(readFileSync(new URL('./replacement-inventory/user-golem-gaits.json', import.meta.url), 'utf8')).results;
const approved = new Map(measurements.results.filter(row => row.status === 'credible-joint-estimate').map(row => [row.id, row]));
const hover = new Set(['wraith', 'banshee', 'revenant']);
const clawIds = new Set(['harpy', 'cliff_harpy', 'storm_harpy']);
const aliasedIds = new Set(['zombie', 'plague_zombie']);
// The Forest alpha repair changes only Tree alphaMode/cutoff. Full binary data,
// nodes, accessors, skins and animation JSON match the measured predecessor.
const materialOnlyRevisions = new Map([
  ['4a167c124d5987959af011c4e4f8a46355e0e87ecd1ba39ef431e0038ed196a0','837157dbd042088df18c626c4cc4356f5c5d651a89bb7bed63eb7462eb9da0d5'],
]);

export function applyGaitMetadata(entry) {
  const id = entry.id.replace(/^creature_/, '');
  const measured = approved.get(id);
  const userGolem=userGolems.find(row=>row.id===entry.id);
  if(userGolem){
    if(entry.sha256!==userGolem.sha256||!userGolem.speedMatchedEligible)throw new Error(`${id}: source gait needs fresh measurement`);
    entry.impliedWalkMps=userGolem.impliedWalkMps;entry.impliedRunMps=userGolem.impliedRunMps;entry.groundY=userGolem.groundY;
    entry.metadata.gaitMeasurement={status:'credible-geometry-estimate',source:'tools/rpg-bestiary/replacement-inventory/user-golem-gaits.json',visualContactAccepted:false};
  }
  const complete=completeSources.find(row=>row.id===entry.id);
  if(complete){
    if(entry.sha256!==complete.sha256&&materialOnlyRevisions.get(entry.sha256)!==complete.sha256)throw new Error(`${id}: complete source changed; gait measurement needs review`);
    if(!complete.speedMatchedEligible)throw new Error(`${id}: source gait is not eligible for speed matching`);
    entry.impliedWalkMps=complete.impliedWalkMps;entry.impliedRunMps=complete.impliedRunMps;entry.groundY=complete.groundY;
    entry.metadata.gaitMeasurement={status:'credible-geometry-estimate',source:'tools/rpg-bestiary/replacement-inventory/complete-source-gaits.json',visualContactAccepted:false,contactReview:complete.contactReview};
  }
  if(id==='webweaver_spider'){
    if(entry.sha256!==spider.sha256)throw new Error('Approved spider geometry changed; gait measurement needs review');
    entry.impliedWalkMps=spider.impliedWalkMps;entry.impliedRunMps=spider.impliedRunMps;entry.groundY=spider.groundY;
    entry.metadata.gaitMeasurement={status:'credible-geometry-estimate',source:'tools/rpg-bestiary/replacement-inventory/spider-gait.json',visualContactAccepted:false};
  }
  if (measured) {
    entry.impliedWalkMps = measured.impliedWalkMps;
    entry.impliedRunMps = measured.impliedRunMps;
    entry.metadata.gaitMeasurement = { status: measured.status, source: 'tools/rpg-bestiary/gait-results.json', visualContactAccepted: false };
  }
  const geometry = measurements.results.find(row => row.id === id)?.geometryContact;
  if (clawIds.has(id) || (aliasedIds.has(id) && entry.metadata.gaitClipAliases?.Run === 'Walk')) {
    if (!geometry) throw new Error(`${id}: missing measured contact geometry`);
    entry.impliedWalkMps = geometry.walk.impliedMps;
    entry.impliedRunMps = aliasedIds.has(id) ? geometry.walk.impliedMps : geometry.run.impliedMps;
    entry.metadata.gaitMeasurement = { status: 'credible-geometry-estimate', source: 'tools/rpg-bestiary/gait-results.json', visualContactAccepted: false };
  }
  // Opt in only measured source characters; production chooses the measured
  // Walk or Run reference before computing its animation rate.
  if (entry.impliedWalkMps > 0 && entry.impliedRunMps > 0) entry.locomotionPolicy = 'speed-matched';
  if (hover.has(id)) {
    entry.groundY = 0;
    entry.metadata.grounding = 'Intentional source robe hover; preserve the 9 cm authored clearance.';
  }
  if (id === 'marsh_wasp') {
    entry.groundY = 0;
    entry.metadata.grounding = 'Preserve the original complete wasp flight altitude.';
  }
  return entry;
}
