import fs from 'node:fs';
import path from 'node:path';

// Records completed evidence without changing acceptance or production files.
const out='art/rebuild/candidates/finish-quadrupeds';
const review=JSON.parse(fs.readFileSync(path.join(out,'visual-review.json')));
const records=[2,3].flatMap(n=>JSON.parse(fs.readFileSync(`test-results/finish-quadrupeds-catalogue/shard${n}/gallery.json`)).records);
review.revision=6;
review.stagedRevision=6;
review.sourceRevision=7;
review.pendingHardwareReview=['lynx source revision 7 (not yet exported)'];
review.scope='All 145 catalogue screenshots inspected on hardware. Fresh independent critic inspected all 26 Bighorn/Tapir static and lifecycle images and rejects both final visual quality; root retained direction but owns unresolved promotion decision. Lynx revision 6 body remains rejected; source revision 7 awaits export and hardware review.';
for(const asset of review.assets){
  const entry=records.find(r=>r.asset===asset.id).assetMetadata;
  asset.sha256=entry.sha256;
  asset.stagedSha256=entry.sha256;
  asset.stagedBytesMatchInspectedRevision=true;
  asset.inspectedScreenshots=['front','side','rear','gameplay','run'].map(v=>`test-results/finish-quadrupeds-catalogue/shard${asset.id.endsWith('lynx')?2:3}/${asset.id}-${v}.png`);
  if(asset.id.endsWith('lynx')){
    asset.findings=['Head planes improved in revision 6. Root and independent critic still reject corrugated lower legs, inflated separate toes and smudged coat.','Source revision 7 replaces separate toes with unified grooved paws, tapers wrists/hocks, raises field resolution and revises fur/dappling. No revision 7 visual acceptance yet.'];
  }else{
    const species=asset.id.slice(9);
    asset.lifecycleReport=`test-results/quadruped-lifecycle/${species}-settled/report.json`;
    asset.independentCriticDisposition='rebuild';
    asset.independentCriticFindings=species==='cairn_bighorn'?'Uniform tan finish, bead eyes, segmented inflated horns and thin lower legs ending in separate hoof blocks remain toy-like.':'Capsule torso, narrow elongated head, bulbous toe knobs, circular ear rims and projecting eyes remain toy-like.';
    asset.findings=asset.findings.filter(f=>!f.startsWith('Five catalogue'));
    asset.findings.push('Independent critic inspected five catalogue views and eight natural lifecycle images. Trace supports real gameplay transitions; final visual acceptance is rejected pending root decision.');
    if(species==='bracken_tapir')asset.lifecycleReanalysis='test-results/quadruped-lifecycle/bracken_tapir-settled/trace-reanalysis.json';
  }
}
fs.writeFileSync(path.join(out,'visual-review.json'),JSON.stringify(review,null,2)+'\n');
