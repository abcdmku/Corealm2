import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const here = 'assets/art/tripo/imports/creatures/audit-polish-skeletons';
const staged = `${here}/sources`;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stagedCatalog = JSON.parse(await readFile(`${staged}/catalog.json`, 'utf8'));
const stagedLab = JSON.parse(await readFile(`${staged}/lab-catalog.json`, 'utf8'));
const builderSha256 = hash(await readFile(import.meta.filename));
await mkdir(here, { recursive: true });
const measuredSize = {
  archer: { x:0.9041792361384615, y:1.8163383573499348, z:0.8780299321925482 },
  mage: { x:0.9102649452258651, y:2.060643299129631, z:0.8617701186334273 },
  soldier: { x:1.4039481864757103, y:2.005717396103078, z:0.9353511117207347 },
};

// Shapes are in the original rig's centimetre-like bind space. Each plate has one
// rigid joint influence and therefore follows the authored animation without
// stretching through an elbow, shoulder or neck. The source skin is untouched.
const gear = {
  archer: [
    { name:'antlered target circlet', joint:'Bip001_Head', polygon:[[-8,98],[-6,103],[-3,101],[0,106],[3,101],[6,103],[8,98],[5,97],[0,100],[-5,97]], z:[5.7,7.6] },
    { name:'left arrowhead pauldron', joint:'Bip001_L_UpperArm', polygon:[[7,83],[13,88],[19,84],[18,77],[14,78],[9,76]], z:[-2,3] },
    { name:'right arrowhead pauldron', joint:'Bip001_R_UpperArm', polygon:[[-7,83],[-13,88],[-19,84],[-18,77],[-14,78],[-9,76]], z:[-2,3] },
    { name:'archer chest chevron', joint:'Bip001_Spine1', polygon:[[-8,84],[0,78],[8,84],[6,73],[0,70],[-6,73]], z:[5.8,8.9] },
  ],
  mage: [
    { name:'crescent crown left', joint:'Bip001_Head', polygon:[[-5,97],[-13,109],[-7,106],[-3,100]], z:[4.8,7] },
    { name:'crescent crown right', joint:'Bip001_Head', polygon:[[5,97],[13,109],[7,106],[3,100]], z:[4.8,7] },
    { name:'crescent crown bridge', joint:'Bip001_Head', polygon:[[-6,98],[0,104],[6,98],[3,96],[0,100],[-3,96]], z:[5.2,7.4] },
    { name:'left ritual mantle', joint:'Bip001_L_UpperArm', polygon:[[7,86],[15,91],[23,81],[20,74],[13,77]], z:[-2,3] },
    { name:'right ritual mantle', joint:'Bip001_R_UpperArm', polygon:[[-7,86],[-15,91],[-23,81],[-20,74],[-13,77]], z:[-2,3] },
    { name:'sternum reliquary', joint:'Bip001_Spine1', polygon:[[-7,84],[0,88],[7,84],[4,70],[0,66],[-4,70]], z:[6.2,9.2] },
  ],
  soldier: [
    { name:'graveguard helm crest', joint:'Bip001_Head', polygon:[[-7,99],[-7,106],[-3,105],[0,112],[3,105],[7,106],[7,99],[0,101]], z:[4.7,7.6] },
    { name:'left fortress pauldron', joint:'Bip001_L_UpperArm', polygon:[[6,84],[16,91],[25,83],[22,73],[14,76],[8,75]], z:[-2,4] },
    { name:'right fortress pauldron', joint:'Bip001_R_UpperArm', polygon:[[-6,84],[-16,91],[-25,83],[-22,73],[-14,76],[-8,75]], z:[-2,4] },
    { name:'cuirass', joint:'Bip001_Spine1', polygon:[[-10,85],[0,88],[10,85],[11,69],[5,64],[-5,64],[-11,69]], z:[5.8,10.2] },
    { name:'graveguard fauld', joint:'Bip001_Pelvis', polygon:[[-10,61],[10,61],[12,48],[5,46],[0,51],[-5,46],[-12,48]], z:[4.2,8.2] },
  ],
};

function makeGear(doc, kind) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const joints = new Map(skin.listJoints().map((node, index) => [node.getName(), index]));
  const buffer = root.listBuffers()[0];
  const position=[], normal=[], uv=[], jointArray=[], weight=[], indices=[];
  const descriptions=[];
  const addTriangle = (a,b,c,joint,bounds) => {
    const ab=b.map((v,i)=>v-a[i]), ac=c.map((v,i)=>v-a[i]);
    const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    const mag=Math.hypot(...cross)||1, n=cross.map(v=>v/mag);
    for(const p of [a,b,c]) {
      position.push(...p); normal.push(...n);
      // Image-generated aged metal/rune detail from the existing equipment atlas.
      const tx=(p[0]-bounds.minX)/(bounds.maxX-bounds.minX||1);
      const ty=(p[1]-bounds.minY)/(bounds.maxY-bounds.minY||1);
      uv.push(.19+.25*tx, .48+.19*ty);
      jointArray.push(joint,0,0,0); weight.push(1,0,0,0);
      indices.push(indices.length);
    }
  };
  for(const shape of gear[kind]) {
    const joint=joints.get(shape.joint); assert(Number.isInteger(joint),shape.joint);
    const poly=shape.polygon, [back,front]=shape.z;
    const bounds={minX:Math.min(...poly.map(p=>p[0])),maxX:Math.max(...poly.map(p=>p[0])),minY:Math.min(...poly.map(p=>p[1])),maxY:Math.max(...poly.map(p=>p[1]))};
    const face=poly.map(([x,y])=>[x,y,front]);
    const rear=poly.map(([x,y])=>[x,y,back]);
    for(let i=1;i<face.length-1;i++) {addTriangle(face[0],face[i],face[i+1],joint,bounds);addTriangle(rear[0],rear[i+1],rear[i],joint,bounds);}
    for(let i=0;i<face.length;i++) {const k=(i+1)%face.length;addTriangle(face[i],rear[i],rear[k],joint,bounds);addTriangle(face[i],rear[k],face[k],joint,bounds);}
    descriptions.push({name:shape.name,joint:shape.joint,triangles:4*poly.length-4});
  }
  const attr=(name,type,array)=>doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
  const primitive=doc.createPrimitive('elite_gear').setAttribute('POSITION',attr('gear_position',Accessor.Type.VEC3,new Float32Array(position)))
    .setAttribute('NORMAL',attr('gear_normal',Accessor.Type.VEC3,new Float32Array(normal)))
    .setAttribute('TEXCOORD_0',attr('gear_uv',Accessor.Type.VEC2,new Float32Array(uv)))
    .setAttribute('JOINTS_0',attr('gear_joints',Accessor.Type.VEC4,new Uint16Array(jointArray)))
    .setAttribute('WEIGHTS_0',attr('gear_weights',Accessor.Type.VEC4,new Float32Array(weight)))
    .setIndices(attr('gear_indices',Accessor.Type.SCALAR,new Uint16Array(indices)));
  const material=root.listMaterials().find(m=>m.getName().endsWith('_DS_equipment_standard'));
  assert(material?.getBaseColorTexture());
  primitive.setMaterial(material);
  const mesh=doc.createMesh('elite_role_armor').addPrimitive(primitive);
  const node=doc.createNode('EliteRoleArmor').setMesh(mesh).setSkin(skin);
  const source=root.listNodes().find(n=>n.getName()==='DungeonSkeletonSource'); assert(source);
  source.addChild(node);
  return descriptions;
}

const expectedClips=['Idle','Walk','Run','Attack','Hit','HitLeft','HitRight','Death'];
const records=[], promotionAssets=[], reviewAssets=[], reviewFiles={};
for(const kind of ['archer','mage','soldier']) {
  const id=`creature_skeleton_${kind}_elite`, original=`creature_skeleton_${kind}`;
  const stage=stagedCatalog.targets.find(x=>x.id===id);
  const stagedAsset=stagedLab.assets.find(x=>x.id===id);
  const stagedBytes=await readFile(`${staged}/${id}.glb`);
  assert.equal(hash(stagedBytes),stage.sha256);
  const doc=await io.readBinary(stagedBytes);
  const before=doc.getRoot();
  const oldMeshCount=before.listMeshes().length;
  const oldJointNames=before.listSkins()[0].listJoints().map(n=>n.getName());
  const oldClips=before.listAnimations().map(a=>a.getName());
  assert.deepEqual(oldClips,expectedClips);
  const pieces=makeGear(doc,kind);
  const bytes=await io.writeBinary(doc), file=`${id}.glb`;
  const check=(await io.readBinary(bytes)).getRoot();
  assert.equal(check.listMeshes().length,oldMeshCount+1);
  assert.deepEqual(check.listAnimations().map(a=>a.getName()),expectedClips);
  assert.deepEqual(check.listSkins()[0].listJoints().map(n=>n.getName()),oldJointNames);
  assert.equal(check.listMeshes().at(-1).getName(),'elite_role_armor');
  await writeFile(`${here}/${file}`,bytes);
  const sha256=hash(bytes);
  const base={...stagedAsset,
    bytes:bytes.length,sha256,candidateFile:file,
    size:measuredSize[kind],
    triangles:stagedAsset.triangles+pieces.reduce((n,p)=>n+p.triangles,0),
    sourceProvenance:{...stagedAsset.sourceProvenance,
      candidateFile:`${here}/${file}`,candidateSha256:sha256,
      modification:'Corealm built-in imagegen edited two layered UV albedo atlases in staged elite source; original licensed rig, skin and eight clips retained. Rigid joint-weighted role armor uses the same generated equipment atlas. Scale is inherited from staged elite source.',
      upstreamCandidateFile:`${staged}/${file}`,upstreamCandidateSha256:stage.sha256,
      generator:`${here}/build-candidate.mjs`,generatorSha256:builderSha256},
    metadata:{...stagedAsset.metadata,artDirection:'High-tier crypt veteran with distinct role armor: archer circlet and arrowhead shoulders, mage crescent crown and ritual mantle, soldier crested helm and fortress plates.',gear:pieces},
    acceptance:{assetAudit:true,labAccepted:false,worldIntegrated:false},
  };
  delete base.metadata.silhouetteLimit;
  promotionAssets.push(base);
  reviewAssets.push({...base,id:original,is:`${base.is} — review override`,file:`models/creature/${original}.glb`,
    metadata:{...base.metadata,reviewOverride:true,finalPromotionId:id}});
  reviewFiles[original]=file;
  records.push({id,reviewOverrideId:original,file,bytes:bytes.length,sha256,sourceSha256:stage.sourceSha256,
    upstreamCandidateSha256:stage.sha256,size:measuredSize[kind],base:stage.base,gear:pieces,
    clips:expectedClips,attackDurationSeconds:kind==='soldier'?1.5:1.55,
    attackContactPolicy:'Worker combat event; source clip has no embedded contact marker. No attack timing edit proposed.',
    sourceMotionRetained:true,labAccepted:false,worldIntegrated:false});
}
const pack={...stagedLab.pack,derivation:'Licensed source skeleton, skin and eight clips retained; image-generated layered bone/equipment atlases from staged elite candidates; new rigid joint-weighted role armor and modest elite presentation scale.'};
const lab={schema:'corealm-lab-asset-candidates/1',pack,assets:reviewAssets,files:reviewFiles,
  note:'Temporary production-ID review overrides. Review all three with the existing presets; do not promote under these IDs.'};
const promotion={schema:'corealm-creature-promotion/1',pack,assets:promotionAssets,sourceRoot:here,destinationRoot:'game/public/assets',apply:false,
  prerequisite:'Root lab browser screenshot review and motion-state proof, then root maps selected high-tier presets to elite IDs.'};
const catalog={schema:'corealm-polish-skeleton-candidates/1',accepted:false,status:'awaiting-root-lab-review',
  reviewOverrideIds:records.map(x=>x.reviewOverrideId),finalPromotionIds:records.map(x=>x.id),starterAssetsPreserved:true,
  targets:records,tierSelectors:stagedCatalog.tierSelectors,
  contentRecommendation: {
    rootOwnedField:'game/content/data/creatureDefinitions.json -> each listed definition.presentation.assetId',
    overrides:Object.fromEntries(Object.entries(stagedCatalog.tierSelectors).map(([kind,ids])=>[`creature_skeleton_${kind}_elite`,ids])),
    preserveStarters: {
      skeleton_archer_t5:'creature_skeleton_archer',
      skeleton_mage_t20:'creature_skeleton_mage',
      skeleton_soldier_t5:'creature_skeleton_soldier',
    },
    levelRule:'Only the listed level-50 and level-70 definitions receive elite visuals. Their inherited low-tier base definitions stay on starter assets.',
  },
  acceptance:{cpuValidated:true,labAccepted:false,worldIntegrated:false}};
await Promise.all([
  writeFile(`${here}/catalog.json`,JSON.stringify(catalog,null,2)+'\n'),
  writeFile(`${here}/lab-catalog.json`,JSON.stringify(lab,null,2)+'\n'),
  writeFile(`${here}/promotion.json`,JSON.stringify(promotion,null,2)+'\n'),
]);
console.log(JSON.stringify(records.map(({id,reviewOverrideId,sha256,bytes,gear})=>({id,reviewOverrideId,sha256,bytes,gear:gear.map(x=>x.name)})),null,2));
