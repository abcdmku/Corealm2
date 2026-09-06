import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {Box3,Matrix4,Vector3} from 'three';
import {describe,expect,it} from 'vitest';
const root='art/rebuild/candidates/finish-structures/source-bedding';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
describe('staged original bedding panel assemblies',()=>{
 it('preserves every original geometry channel, index and map in the exported assets',async()=>{
  const catalogue=JSON.parse(await readFile(`${root}/catalog.json`,'utf8'));
  expect(sha(await readFile(catalogue.source.path))).toBe(catalogue.source.sha256);
  expect(sha(await readFile(catalogue.generator))).toBe(catalogue.generatorSha256);
  expect(catalogue.pack.license).toContain('CC0-1.0');expect(catalogue.pack.license).toContain('DEXSOFT');expect(catalogue.visualAccepted).toBe(false);
  expect(sha(await readFile(catalogue.support.path))).toBe(catalogue.support.sha256);
  const io=new NodeIO(),source=await io.read(catalogue.source.path),original=source.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const maps=source.getRoot().listTextures().map(texture=>sha(texture.getImage()!)).sort();
  for(const asset of catalogue.assets){
   const bytes=await readFile(`${root}/${asset.file}`),doc=await io.readBinary(bytes),primitive=doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
   expect(sha(bytes)).toBe(asset.sha256);
   const actualMaps=doc.getRoot().listTextures().map(texture=>sha(texture.getImage()!));for(const map of maps)expect(actualMaps).toContain(map);
   expect(primitive.listSemantics()).toEqual(original.listSemantics());
   for(const semantic of original.listSemantics())expect(primitive.getAttribute(semantic)!.getArray()).toEqual(original.getAttribute(semantic)!.getArray());
   expect(primitive.getIndices()!.getArray()).toEqual(original.getIndices()!.getArray());
   expect(doc.getRoot().listNodes().filter(node=>node.getMesh()).length).toBe(asset.panels.length+asset.supportBodies.length);
   expect(asset.topology).toContain('Not a watertight');
  }
 });
 it('fits every transformed source panel inside the exact legacy bounds and preserves a descending Scree profile',async()=>{
  const catalogue=JSON.parse(await readFile(`${root}/catalog.json`,'utf8'));
  const manifest=JSON.parse(await readFile('game/public/assets/manifest.json','utf8')),io=new NodeIO();
  for(const asset of catalogue.assets){
   const doc=await io.read(`${root}/${asset.file}`),bounds=new Box3();
   for(const node of doc.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
    const matrix=new Matrix4().fromArray(node.getWorldMatrix()),p=primitive.getAttribute('POSITION')!;
    expect(matrix.determinant()).toBeGreaterThan(0);
    for(let i=0;i<p.getCount();i++)bounds.expandByPoint(new Vector3().fromArray(p.getElement(i,[])).applyMatrix4(matrix));
   }
   const legacy=manifest.assets.find((a:any)=>a.id===asset.placement.replacesAssetId),size=bounds.getSize(new Vector3());
   for(const axis of ['x','y','z'] as const){expect(bounds.min[axis]).toBeCloseTo(legacy.base[axis],5);expect(size[axis]).toBeCloseTo(legacy.size[axis],5);}
   if(asset.id==='corealm_scree_slide')expect(asset.rearToFrontDrop).toBeGreaterThan(2);
  }
 });
});
