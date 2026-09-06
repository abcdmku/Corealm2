import fs from 'node:fs';
const findings={
animal_cattle:['rebuild','Retain cow base; repair neck/shoulder/upper-leg seam rings and blunt unsplit hoof appearance.'],
animal_aurochs:['rebuild','Domestic cow silhouette, udder and heavy belly undermine wild bovine identity; repair seam rings and brown material separation.'],
animal_goat:['keep','Credible proportions, horns and fur. Plain hoof ends and angular compressed run pose need motion review.'],
animal_deer:['keep','Clear deer proportions and antlers. Coarse antler facets, plain lower legs and dark rear detail.'],
animal_coyote:['keep','Strong anatomy, coat and feet. UI Forest Wolf versus source coyote identity needs confirmation.'],
animal_bear:['keep','Convincing heavy bear mass and claws. Smooth fur outline and compressed shoulder in run need temporal review.'],
animal_boar:['keep','Coherent boar anatomy and tusks. Smooth dorsal outline, repetitive bristles and plain hoof wedges.'],
animal_ibex:['keep','Distinct ribbed horns and credible anatomy. Plain hoof ends; raised idle legs require support review.'],
animal_hog:['keep','Coherent sow anatomy. Muddy coat and plain feet; no Run clip in metadata.'],
animal_rat:['keep','Recognizable rodent and tapering tail. Small gameplay silhouette; no Run clip in metadata.'],
animal_rabbit:['keep','Sound rabbit silhouette. Dark fur and shoulder seams; neutral grounding proof pending.'],
animal_rabbit_dark:['keep','Sound rabbit base. Pale neck/shoulder/belly seams need cleanup.'],
boss_rhino_air:['keep','Strong fantasy rhino base. Detached underbody triangles require investigation; roc identity mismatch.'],
boss_rhino_earth:['keep','Strong fantasy rhino base. Painted green markings do not communicate stone armor; underbody triangles.'],
boss_rhino_water:['keep','Strong fantasy rhino base. Flat blue patches lack water/ice construction; underbody triangles.'],
creature_marchwild_horse:['rebuild','Balloon torso, soft muzzle, unstructured lower legs, boot hooves and solid-strip mane/tail.'],
creature_redbrush_fox:['rebuild','Tubular torso, abrupt rump/tail transition, knobby legs, mitten feet, projecting eyes and thick ear inserts.'],
creature_duskoak_lynx:['rebuild','Revision 6 corrugated legs, inflated toes, barrel torso and smudged coat. Revision 7 source awaits export and review.'],
creature_rootdelve_badger:['rebuild','Capsule torso, circular rump, attached shoulder balls, mitten feet, pin ankles and overly long head wedge.'],
creature_quillback_porcupine:['rebuild','Regular sparse quill rows expose bare barrel; smooth oval head, round shoulders, mitten feet and bare conical tail.'],
creature_cairn_bighorn:['rebuild','Root retained direction; independent lifecycle/static critic rejects bead eyes, segmented hose horns, peg legs, separate hoof blocks and uniform tan finish. Root decision pending.'],
creature_marsh_moose:['rebuild','Blob muzzle, featureless dark mass, thick antler roots, leaf dewlap, zigzag idle legs and generic cuff hooves.'],
creature_bracken_tapir:['rebuild','Root retained direction; independent lifecycle/static critic rejects capsule torso, bead eyes, circular rim ears and bulbous toes. Root decision pending.'],
creature_reedjaw_crocodile:['keep','Believable low torso, armored back, jaw and muscular tail. Dark facial detail and stretched flank scales.'],
creature_kiln_salamander:['keep','Coherent elongated anatomy and yellow markings. Crushed black detail and small feet need brighter close inspection.'],
creature_slateback_tortoise:['keep','Strong shell and material separation. Cylindrical neck/simple legs, regular ridges; similar run/side stills do not prove gait.'],
creature_ashscale_monitor:['rebuild','Humanlike shoulder bulges, thin vertical forearms, flat star hands and abrupt narrow neck; generic dinosaur silhouette.'],
creature_basalt_drake:['replace','Anatomical base is coherent, but prominent paired pale head horns conflict with the user direction against horned monster designs.'],
creature_quarry_nightmare:['replace','Demonic hooked skull and horn/spine projections conflict with user direction. Blunt tall shoulder towers also need source conversion investigation; brown coat contradicts pale/albino identity.']
};
const rows=[];
for(let shard=1;shard<=3;shard++){
 const dir=`test-results/finish-quadrupeds-catalogue/shard${shard}`;
 const gallery=JSON.parse(fs.readFileSync(`${dir}/gallery.json`));
 if(gallery.errors.length||gallery.missing.length)throw new Error(`Unclean shard ${shard}`);
 for(const record of gallery.records){
  const [disposition,notes]=findings[record.asset];
  rows.push({id:record.asset,disposition,notes,sha256:record.assetMetadata.sha256,bytes:record.assetMetadata.bytes,renderer:gallery.renderer,screenshots:['front','side','rear','gameplay','run'].map(v=>`${dir}/${record.asset}-${v}.png`),rootAccepted:false});
 }
}
const limits='All 145 images inspected across three reviewers. KEEP preserves the base for repair and runtime acceptance, not unconditional approval. Stationary clips do not prove travel planting, terrain, transitions or AI. Root owns acceptance and promotion. Bighorn/Tapir direction approval conflicts with the fresh critic; both remain staged.';
const out='art/rebuild/candidates/finish-quadrupeds';
fs.writeFileSync(`${out}/catalogue-visual-audit.json`,JSON.stringify({scope:limits,counts:{total:rows.length,keep:rows.filter(r=>r.disposition==='keep').length,rebuild:rows.filter(r=>r.disposition==='rebuild').length,replace:rows.filter(r=>r.disposition==='replace').length},assets:rows},null,2)+'\n');
fs.writeFileSync(`${out}/catalogue-visual-audit.md`,'# Catalogue visual audit\n\n'+limits+'\n\n| Asset | Disposition | Findings |\n|---|---|---|\n'+rows.map(r=>`| ${r.id} | ${r.disposition.toUpperCase()} | ${r.notes} |`).join('\n')+'\n');
