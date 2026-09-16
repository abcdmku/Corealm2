import { readFile } from 'node:fs/promises';
import { MeshoptDecoder } from 'meshoptimizer';
import { expect, it } from 'vitest';
import { compactModel } from '../tools/lib/compact-model.js';
import { Matrix4, Quaternion, Vector3 } from 'three';

function unpack(b:Buffer) {
  const json=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12))), bin=b.subarray(28+b.readUInt32LE(12));
  const views=json.bufferViews.map((v:any)=>{
    const ext=v.extensions?.EXT_meshopt_compression;
    if(!ext)return bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);
    const bytes=new Uint8Array(v.byteLength);
    MeshoptDecoder.decodeGltfBuffer(bytes,ext.count,ext.byteStride,bin.subarray(ext.byteOffset,ext.byteOffset+ext.byteLength),ext.mode,ext.filter);
    return Buffer.from(bytes);
  });
  return {json,views,accessors:json.accessors.map((a:any)=>{
    const width=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16} as any)[a.type]*({5120:1,5121:1,5122:2,5123:2,5125:4,5126:4} as any)[a.componentType];
    const bytes=Buffer.alloc(a.count*width),view=json.bufferViews[a.bufferView];
    for(let i=0;i<a.count;i++)views[a.bufferView].copy(bytes,i*width,(a.byteOffset??0)+i*(view.byteStride??width),(a.byteOffset??0)+i*(view.byteStride??width)+width);
    return bytes;
  }) as Buffer[]};
}

it.each([false,true])('retains topology, rigs, clip timing and images with bounded delivery precision %s',async precision=>{
  await MeshoptDecoder.ready;
  const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
  for(const id of ['animal_cattle','corealm_oak_1','base_male','wall_plaster_base']) {
    const file=manifest.assets.find((a:any)=>a.id===id).file;
    const input=await readFile(`game/public/assets/${file}`), original=unpack(input), result=unpack(await compactModel(input,precision));
    for(const key of ['meshes','skins','animations','nodes','materials'])expect(result.json[key]).toEqual(original.json[key]);
    const protectedAccessors=new Set<number>((original.json.animations??[]).flatMap((a:any)=>a.samplers.map((s:any)=>s.input)));
    const positions=new Set<number>(original.json.meshes.flatMap((m:any)=>m.primitives.map((p:any)=>p.attributes.POSITION)));
    const positionScale = new Map<number,number>();
    const visit = (index:number,parent:Matrix4) => {
      const node=original.json.nodes[index],local=node.matrix ? new Matrix4().fromArray(node.matrix)
        : new Matrix4().compose(new Vector3().fromArray(node.translation??[0,0,0]),
          new Quaternion().fromArray(node.rotation??[0,0,0,1]),new Vector3().fromArray(node.scale??[1,1,1]));
      const world=parent.clone().multiply(local);
      if(node.mesh!==undefined) for(const p of original.json.meshes[node.mesh].primitives)
        positionScale.set(p.attributes.POSITION,Math.max(positionScale.get(p.attributes.POSITION)??0,world.getMaxScaleOnAxis()));
      for(const child of node.children??[])visit(child,world);
    };
    for(const node of original.json.scenes[original.json.scene??0].nodes)visit(node,new Matrix4());
    for(const [i,expected] of original.accessors.entries()) {
      const actual=result.accessors[i]!;
      expect(actual.length).toBe(expected.length);
      if(!precision || original.json.accessors[i].componentType!==5126 || protectedAccessors.has(i)) {
        expect(Buffer.compare(actual,expected),`${id} accessor ${i}`).toBe(0);continue;
      }
      let maxError=0,maxValue=0;
      for(let j=0;j<expected.length;j+=4){maxError=Math.max(maxError,Math.abs(expected.readFloatLE(j)-actual.readFloatLE(j)));maxValue=Math.max(maxValue,Math.abs(expected.readFloatLE(j)));}
      expect(maxError,`${id} accessor ${i}`).toBeLessThanOrEqual(maxValue/(positions.has(i)?4096:1024)+1e-7);
      if(positions.has(i)) expect(maxError*Math.sqrt(3)*positionScale.get(i)!,`${id} position error in metres`).toBeLessThan(.005);
    }
    for(const [i,im] of (original.json.images??[]).entries()) {
      const next=result.json.images[i];
      if(im.bufferView!==undefined)expect(Buffer.compare(original.views[im.bufferView],result.views[next.bufferView])).toBe(0);
      else expect(next.uri).toBe(im.uri);
    }
  }
});
