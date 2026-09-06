import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {Box3,Matrix4,Vector3} from 'three';
import {describe,expect,it} from 'vitest';
const root='art/rebuild/candidates/finish-structures/closed-rock09';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
describe('staged single-body Rock 09 shortcuts',()=>{
 it('retains every native source channel, index and embedded map without additional geometry',async()=>{
  const catalogue=JSON.parse(await readFile(`${root}/catalog.json`,'utf8'));
  expect(sha(await readFile(catalogue.generator))).toBe(catalogue.generatorSha256);
  expect(catalogue.pack.license).toBe('CC0-1.0');expect(catalogue.visualAccepted).toBe(false);
  const io=new NodeIO(),source=await io.read(catalogue.source.file),original=source.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  const maps=source.getRoot().listTextures().map(texture=>sha(texture.getImage()!)).sort();
  for(const asset of catalogue.assets){
   const bytes=await readFile(`${root}/${asset.file}`),doc=await io.readBinary(bytes),primitive=doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
   expect(sha(bytes)).toBe(asset.sha256);expect(doc.getRoot().listMeshes()).toHaveLength(1);
   expect(doc.getRoot().listNodes().filter(node=>node.getMesh())).toHaveLength(1);
   expect(doc.getRoot().listTextures().map(texture=>sha(texture.getImage()!)).sort()).toEqual(maps);
   expect(primitive.listSemantics()).toEqual(original.listSemantics());
   for(const semantic of original.listSemantics())expect(primitive.getAttribute(semantic)!.getArray()).toEqual(original.getAttribute(semantic)!.getArray());
   expect(primitive.getIndices()!.getArray()).toEqual(original.getIndices()!.getArray());
   expect(asset.triangles).toBe(12416);
  }
 });
 it('keeps exact legacy pivots/bounds under positive transforms and reports the unmodified-ground limitation',async()=>{
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
   expect(asset.support.pivotChangedBeyondLegacyFit).toBe(false);expect(asset.support.terrainChanged).toBe(false);
   if(asset.id==='corealm_scree_slide')expect(asset.rearToFrontQuarterDrop).toBeGreaterThan(2);
  }
 });
});
