import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {Box3,Matrix4,Vector3} from 'three';
import {describe,it,expect} from 'vitest';
const root='art/rebuild/candidates/finish-structures/source-outcrops';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
describe('licensed shortcut outcrop arrangements',()=>{
 it('limits the quiet variant to material response and an extra albedo UV channel',async()=>{
  const catalog=JSON.parse(await readFile(`${root}-quiet/shortcut-outcrops.json`,'utf8')),io=new NodeIO();
  for(const entry of catalog.assets){
   const original=await io.read(`${root}/${entry.file}`),quiet=await io.read(`${root}-quiet/${entry.file}`);
   expect(quiet.getRoot().listNodes().map(node=>node.getMatrix())).toEqual(original.getRoot().listNodes().map(node=>node.getMatrix()));
   const a=original.getRoot().listMeshes()[0]!.listPrimitives()[0]!,b=quiet.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
   for(const semantic of a.listSemantics())expect(Array.from(b.getAttribute(semantic)!.getArray()!)).toEqual(Array.from(a.getAttribute(semantic)!.getArray()!));
   expect(b.getAttribute('TEXCOORD_2')).toBeTruthy();
   const material=b.getMaterial()!;expect(material.getNormalScale()).toBe(.16);expect(material.getBaseColorTextureInfo()!.getTexCoord()).toBe(2);
   expect(hash(material.getNormalTexture()!.getImage()!)).toBe(hash(a.getMaterial()!.getNormalTexture()!.getImage()!));
   expect(hash(material.getBaseColorTexture()!.getImage()!)).toBe(catalog.material.albedoSha256);
  }
 });
 it('preserves native geometry channels and material images with truthful source provenance',async()=>{
  const catalog=JSON.parse(await readFile(`${root}/shortcut-outcrops.json`,'utf8'));
  const sourceBytes=await readFile(catalog.source.path),io=new NodeIO(),source=await io.readBinary(sourceBytes);
  expect(hash(sourceBytes)).toBe(catalog.source.sha256);
  expect(catalog.pack.license).toContain('DEXSOFT');expect(catalog.pack.license).toContain('Standard Unity Asset Store EULA');
  for(const entry of catalog.assets){
   const bytes=await readFile(`${root}/${entry.file}`),document=await io.readBinary(bytes);
   expect(hash(bytes)).toBe(entry.sha256);
   const originals=source.getRoot().listMeshes().flatMap(mesh=>mesh.listPrimitives());
   const copies=document.getRoot().listMeshes().flatMap(mesh=>mesh.listPrimitives());
   expect(copies).toHaveLength(originals.length);
   for(let i=0;i<originals.length;i++){
    const original=originals[i]!,copy=copies[i]!;
    expect(copy.listSemantics()).toEqual(original.listSemantics());
    for(const semantic of original.listSemantics())expect(Array.from(copy.getAttribute(semantic)!.getArray()!)).toEqual(Array.from(original.getAttribute(semantic)!.getArray()!));
    expect(Array.from(copy.getIndices()!.getArray()!)).toEqual(Array.from(original.getIndices()!.getArray()!));
   }
   expect(document.getRoot().listTextures().map(texture=>hash(texture.getImage()!))).toEqual(source.getRoot().listTextures().map(texture=>hash(texture.getImage()!)));
   const bounds=new Box3();let triangles=0;
   for(const node of document.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
    const matrix=new Matrix4().fromArray(node.getWorldMatrix()),position=primitive.getAttribute('POSITION')!;
    triangles+=(primitive.getIndices()?.getCount()??position.getCount())/3;
    for(let i=0;i<position.getCount();i++)bounds.expandByPoint(new Vector3().fromArray(position.getElement(i,[])).applyMatrix4(matrix));
   }
   expect(triangles).toBe(entry.triangles);
   for(const axis of ['x','y','z'] as const){expect(bounds.min[axis]).toBeCloseTo(entry.base[axis],5);expect(bounds.getSize(new Vector3())[axis]).toBeCloseTo(entry.size[axis],5);}
  }
 });
});

