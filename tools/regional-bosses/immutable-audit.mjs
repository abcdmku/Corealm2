/** Exact payload identity outside a targeted Hit edit. */
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const accessor=a=>a?{type:a.getType(),component:a.getComponentType(),normalized:a.getNormalized(),count:a.getCount(),sha256:hash(Buffer.from(a.getArray().buffer,a.getArray().byteOffset,a.getArray().byteLength))}:null;
async function snapshot(file){const root=(await io.read(file)).getRoot();return {
 geometry:root.listNodes().filter(n=>n.getMesh()).map(n=>({node:n.getName(),skin:n.getSkin()?.getName(),primitives:n.getMesh().listPrimitives().map(p=>({attributes:Object.fromEntries(p.listSemantics().map(s=>[s,accessor(p.getAttribute(s))])),indices:accessor(p.getIndices()),material:p.getMaterial()?.getName()}))})),
 materials:root.listMaterials().map(m=>({name:m.getName(),base:m.getBaseColorFactor(),roughness:m.getRoughnessFactor(),metallic:m.getMetallicFactor(),emissive:m.getEmissiveFactor(),alphaMode:m.getAlphaMode(),alphaCutoff:m.getAlphaCutoff(),doubleSided:m.getDoubleSided(),baseTexture:m.getBaseColorTexture()?hash(m.getBaseColorTexture().getImage()):null})),
 skeleton:root.listSkins().map(s=>({name:s.getName(),inverseBind:accessor(s.getInverseBindMatrices()),joints:s.listJoints().map(j=>({name:j.getName(),translation:j.getTranslation(),rotation:j.getRotation(),scale:j.getScale()}))})),
 clips:root.listAnimations().filter(a=>!/^Hit(?:Left|Right)?$/.test(a.getName())).map(a=>({name:a.getName(),channels:a.listChannels().map(c=>({node:c.getTargetNode().getName(),path:c.getTargetPath(),interpolation:c.getSampler().getInterpolation(),input:accessor(c.getSampler().getInput()),output:accessor(c.getSampler().getOutput())}))})),
};}
const [beforeFile,afterFile,out]=process.argv.slice(2);if(!beforeFile||!afterFile)throw Error('Expected before.glb after.glb [report.json]');
const before=await snapshot(beforeFile),after=await snapshot(afterFile);for(const key of Object.keys(before))assert.deepEqual(after[key],before[key],`Non-Hit ${key} changed`);
const report={beforeFile,afterFile,geometry:true,materials:true,skeleton:true,unchangedClips:before.clips.map(c=>c.name),beforeSnapshotSha256:hash(JSON.stringify(before)),afterSnapshotSha256:hash(JSON.stringify(after))};
if(out)await writeFile(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
