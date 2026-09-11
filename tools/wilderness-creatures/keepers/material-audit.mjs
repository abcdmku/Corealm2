/** Verify the material repair leaves the previously reviewed shapes and motions byte-identical. */
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),out='test-results/wilderness-creatures/keepers',catalog=JSON.parse(await readFile(`${out}/catalog.json`)),rows=[];
const hash=values=>values?createHash('sha256').update(Buffer.from(values.buffer,values.byteOffset,values.byteLength)).digest('hex'):null;
const channels=doc=>doc.getRoot().listAnimations().flatMap(a=>a.listChannels().map(c=>({key:`${a.getName()}:${c.getTargetNode().getName()}:${c.getTargetPath()}`,input:hash(c.getSampler().getInput().getArray()),output:hash(c.getSampler().getOutput().getArray()),interpolation:c.getSampler().getInterpolation()}))).sort((a,b)=>a.key.localeCompare(b.key));
const hierarchy=doc=>doc.getRoot().listNodes().map(n=>({name:n.getName(),parent:n.getParentNode()?.getName()??null,translation:n.getTranslation(),rotation:n.getRotation(),scale:n.getScale(),skin:n.getSkin()?.getName()??null,mesh:n.getMesh()?.getName()??null})).sort((a,b)=>a.name.localeCompare(b.name));
const skins=doc=>doc.getRoot().listSkins().map(s=>({name:s.getName(),skeleton:s.getSkeleton()?.getName()??null,joints:s.listJoints().map(j=>j.getName()),inverseBindMatrices:hash(s.getInverseBindMatrices().getArray())})).sort((a,b)=>a.name.localeCompare(b.name));
const prims=doc=>new Map(doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives().map(p=>[`${m.getName()}:${p.getMaterial().getName()}`,p])));
for(const asset of catalog.assets){const file=catalog.files[asset.id],old=await io.read(`${out}/material-core-baseline/${file}`),now=await io.read(`${out}/${file}`),a=prims(old),b=prims(now),uvAdded=[];assert.deepEqual([...a.keys()].sort(),[...b.keys()].sort());
 for(const[key,p]of a){const q=b.get(key);assert.equal(q.getMode(),p.getMode());assert.equal(hash(q.getIndices()?.getArray()),hash(p.getIndices()?.getArray()));for(const semantic of p.listSemantics())assert.equal(hash(q.getAttribute(semantic)?.getArray()),hash(p.getAttribute(semantic).getArray()),`${asset.id} changed ${semantic}`);for(const semantic of q.listSemantics())if(!p.getAttribute(semantic)){assert.equal(semantic,'TEXCOORD_0');assert.ok(key.endsWith('_cavity_interior'));uvAdded.push(key);}}
 assert.deepEqual(hierarchy(now),hierarchy(old));assert.deepEqual(skins(now),skins(old));assert.deepEqual(channels(now),channels(old));rows.push({id:asset.id,unchangedPrimitiveCount:a.size,unchangedHierarchy:true,unchangedSkins:true,unchangedAnimationChannels:channels(now).length,addedUvOnPreviouslyUnmappedInteriors:uvAdded});
}
await writeFile(`${out}/material-core-audit.json`,JSON.stringify({status:'pass',exception:'Parent authorized adding TEXCOORD_0 only to previously unmapped interior material primitives. Positions, normals, existing UVs, joint IDs, weights, indices, hierarchy, skins and all animation channels are byte-identical.',rows},null,2)+'\n');console.log(JSON.stringify(rows));
