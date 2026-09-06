import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS} from '@gltf-transform/extensions';
import {buildGiantRat} from './giant-rat.mjs';
class FileReader {readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result=`data:${blob.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.();});}}
globalThis.FileReader??=FileReader;
const out=path.resolve('art/rebuild/candidates/finish-bestiary/giant-rat-contact-round2');fs.mkdirSync(out,{recursive:true});
const io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
for(const [name,repair]of [['baseline',false],['giant_rat',true]]){
  const result=await buildGiantRat('giant_rat',{repair}),bytes=new Uint8Array(await new GLTFExporter().parseAsync(result.object,{binary:true,animations:result.clips,onlyVisible:false})),doc=await io.readBinary(bytes);
  for(const binding of result.meta.textureBindings){const material=doc.getRoot().listMaterials().find(m=>m.getName()===binding.materialName);for(const [key,method]of [['baseColorPath','setBaseColorTexture'],['normalPath','setNormalTexture']])if(binding[key])material[method](doc.createTexture(path.basename(binding[key])).setImage(fs.readFileSync(binding[key])).setMimeType('image/png'));}
  const binary=await io.writeBinary(doc),file=path.join(out,`${name}.glb`);fs.writeFileSync(file,binary);const sha256=createHash('sha256').update(binary).digest('hex');fs.writeFileSync(path.join(out,`${name}-metadata.json`),JSON.stringify({...result.meta,finalByteSha256:sha256,acceptance:{cpuContactAudit:'pending',labAccepted:false,hold:['Walk front feet','Run']}},null,2));console.log(JSON.stringify({name,file,sha256,bytes:binary.length,correction:result.meta.contactRepair}));
}
