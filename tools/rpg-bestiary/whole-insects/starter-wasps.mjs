import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
import assert from 'node:assert/strict';

const out='test-results/starter-wasp-variants';
const sourcePath='game/public/assets/models/creature/creature_marsh_wasp.glb';
const source=await readFile(sourcePath), hash=b=>createHash('sha256').update(b).digest('hex');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const variants=[
  {id:'creature_field_wasp',name:'Field Wasp',colour:'moss green',tint:[.48,.62,.34],size:.68},
  {id:'creature_heath_wasp',name:'Heath Wasp',colour:'dusty brown',tint:[.63,.47,.33],size:.62},
  {id:'creature_reed_wasp',name:'Reed Wasp',colour:'slate blue',tint:[.38,.52,.64],size:.72},
];
await mkdir(out,{recursive:true});
const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
const parent=manifest.assets.find(a=>a.id==='creature_marsh_wasp');
const entries=[];
const clips=d=>JSON.stringify(d.getRoot().listAnimations().map(a=>a.listSamplers().map(s=>[hash(Buffer.from(s.getInput().getArray().buffer)),hash(Buffer.from(s.getOutput().getArray().buffer))])));
for(const variant of variants) {
  const doc=await io.readBinary(source), before=clips(doc);
  const bodyMap=doc.createTexture('starter_neutral_scales').setImage(new Uint8Array(await readFile('tools/rpg-bestiary/whole-insects/textures/starter-scales.png'))).setMimeType('image/png');
  for(const primitive of doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives())) {
    const material=primitive.getMaterial();
    if(/_(Yellow|Black)$/.test(material.getName())) {
      primitive.setAttribute('COLOR_0',null);
      material.setBaseColorTexture(bodyMap).setBaseColorFactor([...variant.tint,1]).setRoughnessFactor(.72).setMetallicFactor(0).setNormalScale(.22);
      material.getExtension('KHR_materials_clearcoat')?.setClearcoatFactor(.08);
      material.getExtension('KHR_materials_iridescence')?.setIridescenceFactor(.04);
    } else if(/_LightBlue$/.test(material.getName())) {
      material.setBaseColorFactor([.76,.82,.75,.35]).setRoughnessFactor(.58).setMetallicFactor(0);
      material.getExtension('KHR_materials_clearcoat')?.setClearcoatFactor(.1);
      material.getExtension('KHR_materials_iridescence')?.setIridescenceFactor(.12);
    }
  }
  for(const scene of doc.getRoot().listScenes()) {
    const children=scene.listChildren();
    const wrapper=doc.createNode('starter_wasp_scale').setScale([variant.size,variant.size,variant.size]);
    for(const child of children) {scene.removeChild(child);wrapper.addChild(child);}
    scene.addChild(wrapper);
  }
  doc.getRoot().setExtras({...doc.getRoot().getExtras(),starterVariant:{...variant,sourceSha256:hash(source)}});
  await doc.transform(prune({keepLeaves:true,keepAttributes:true,keepIndices:true}));
  const file=`${out}/${variant.id}.glb`;
  await io.write(file,doc);
  assert.equal(clips(await io.read(file)),before,'Native animation samples remain unchanged');
  const bytes=await readFile(file), entry=structuredClone(parent);
  Object.assign(entry,{id:variant.id,file:`models/creature/${variant.id}.glb`,bytes:bytes.length,sha256:hash(bytes),is:variant.name.toLowerCase(),tags:['creature','rpg','starter',variant.colour],
    size:Object.fromEntries(Object.entries(parent.size).map(([k,n])=>[k,n*variant.size])),base:Object.fromEntries(Object.entries(parent.base).map(([k,n])=>[k,n*variant.size])),groundY:parent.groundY*variant.size});
  entry.metadata.starterVariant={...variant,sourceAssetId:parent.id,sourceSha256:hash(source),appearance:'Muted body, reduced sheen, smaller uniform rig wrapper'};
  entry.metadata.waspAppearance.direction=`Small ${variant.colour} starter wasp with subdued wings`;
  entry.metadata.waspAppearance.material={roughness:.72,metalness:0,normalScale:.22,clearcoat:.08,iridescence:.04};
  entry.metadata.waspAppearance.wings={...entry.metadata.waspAppearance.wings,opacity:.35,iridescence:.12};
  entry.metadata.waspAppearance.textureSource='tools/rpg-bestiary/whole-insects/textures/starter-scales.png';
  entry.acceptance={exported:true,labAccepted:false,worldIntegrated:false};
  entries.push(entry);
}
await writeFile(`${out}/manifest-entries.json`,JSON.stringify(entries,null,2));
assert.equal(hash(await readFile(sourcePath)),hash(source),'High-level wasp must remain unchanged');
console.log(JSON.stringify(variants));
