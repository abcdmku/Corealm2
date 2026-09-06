import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {describe,expect,it} from 'vitest';

const root='art/rebuild/candidates/finish-structures/source-bedding';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
describe('staged bedded shortcut source derivatives',()=>{
 it('pins the scanned source, generator and the embedded original material maps',async()=>{
  const catalogue=JSON.parse(await readFile(`${root}/catalog.json`,'utf8'));
  expect(sha(await readFile(catalogue.source.path))).toBe(catalogue.source.sha256);
  expect(sha(await readFile(catalogue.generator))).toBe(catalogue.generatorSha256);
  expect(catalogue.pack.license).toBe('CC0-1.0');
  expect(catalogue.visualAccepted).toBe(false);
  const io=new NodeIO(),source=await io.read(catalogue.source.path);
  const maps=source.getRoot().listTextures().map(texture=>sha(texture.getImage()!)).sort();
  for(const asset of catalogue.assets){
   const bytes=await readFile(`${root}/${asset.file}`),doc=await io.readBinary(bytes);
   expect(sha(bytes)).toBe(asset.sha256);
   expect(doc.getRoot().listTextures().map(texture=>sha(texture.getImage()!)).sort()).toEqual(maps);
   expect(doc.getRoot().listMaterials().every(material=>!material.getDoubleSided())).toBe(true);
  }
 });
 it('has closed connected topology, normalized normals and exact legacy bounds in both exported GLBs',async()=>{
  const catalogue=JSON.parse(await readFile(`${root}/catalog.json`,'utf8'));
  const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8'));
  const io=new NodeIO();
  for(const asset of catalogue.assets){
   const doc=await io.read(`${root}/${asset.file}`),p=doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
   const positions=p.getAttribute('POSITION')!,normal=p.getAttribute('NORMAL')!,uv=p.getAttribute('TEXCOORD_0')!,indices=p.getIndices()!;
   const legacy=manifest.assets.find((a:any)=>a.id===asset.placement.replacesAssetId);
   const minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity],remap:number[]=[],welded=new Map<string,number>();
   for(let i=0;i<positions.getCount();i++){
    const position=positions.getElement(i,[]),n=normal.getElement(i,[]),textureUV=uv.getElement(i,[]);
    expect([...position,...n,...textureUV].every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...n)).toBeCloseTo(1,4);
    for(let axis=0;axis<3;axis++){minimum[axis]=Math.min(minimum[axis]!,position[axis]!);maximum[axis]=Math.max(maximum[axis]!,position[axis]!);}
    const key=position.map(value=>value.toFixed(5)).join(',');if(!welded.has(key))welded.set(key,welded.size);remap.push(welded.get(key)!);
   }
   for(const [axis,name]of ['x','y','z'].entries()){expect(minimum[axis]).toBeCloseTo(legacy.base[name!],5);expect(maximum[axis]!-minimum[axis]!).toBeCloseTo(legacy.size[name!],5);}
   const edges=new Map<string,number>(),adjacency=new Map<number,Set<number>>();
   for(let i=0;i<indices.getCount();i+=3){
    const ids=[0,1,2].map(j=>remap[indices.getScalar(i+j)]!);expect(new Set(ids).size).toBe(3);
    for(let j=0;j<3;j++){const a=ids[j]!,b=ids[(j+1)%3]!,key=`${Math.min(a,b)},${Math.max(a,b)}`;edges.set(key,(edges.get(key)??0)+1);if(!adjacency.has(a))adjacency.set(a,new Set());adjacency.get(a)!.add(b);}
   }
   expect([...edges.values()].every(count=>count===2)).toBe(true);
   expect(welded.size-edges.size+indices.getCount()/3).toBe(2);
   const visited=new Set<number>(),queue=[0];while(queue.length){const a=queue.pop()!;if(visited.has(a))continue;visited.add(a);for(const b of adjacency.get(a)??[])if(!visited.has(b))queue.push(b);}
   expect(visited.size).toBe(welded.size);
   if(asset.id==='corealm_scree_slide')expect(asset.rearToFrontDrop).toBeGreaterThan(2);
  }
 },20000);
});
