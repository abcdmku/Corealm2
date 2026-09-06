import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";
import { buildPrefab } from "../game/src/render/buildings.js";

it("keeps the actual hall banner and lantern vertices below its sloping native eave", async () => {
  const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json","utf8"));
  const parts = buildPrefab("hall",[12,6],629092596,"plaster");
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
  const material = new MeshBasicMaterial({side:DoubleSide});
  const selected = parts.filter(part=>part.tag === "roof" || part.assetId === "lamp_wall" || part.assetId.startsWith("banner"));
  const byTag = new Map<string,Mesh[]>();
  for (const part of selected) {
    const row = manifest.assets.find((entry:any)=>entry.id===part.assetId);
    const document = await io.read(`game/public/assets/${row.file}`);
    const meshes:Mesh[]=[];
    for (const node of document.getRoot().listNodes()) for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const source=primitive.getAttribute("POSITION")!;
      const values:number[]=[]; const element:number[]=[];
      for(let index=0;index<source.getCount();index++) {source.getElement(index,element);values.push(...element);}
      const geometry=new BufferGeometry().setAttribute("position",new BufferAttribute(new Float32Array(values),3));
      if(primitive.getIndices()) geometry.setIndex(Array.from(primitive.getIndices()!.getArray()!));
      geometry.applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix()));
      const mesh=new Mesh(geometry,material);
      mesh.position.set(part.dx,part.dy,part.dz);mesh.rotation.y=part.rotationY;mesh.scale.setScalar(part.scale);mesh.updateMatrixWorld(true);meshes.push(mesh);
    }
    byTag.set(part.tag,meshes);
  }
  const roof=byTag.get("roof")!;
  let checked=0;
  const penetrations:{tag:string;vertex:number[];roof:number}[]=[];
  for(const part of selected.filter(part=>part.tag!=="roof")) for(const mesh of byTag.get(part.tag)!) {
    const positions=mesh.geometry.getAttribute("position");
    for(let index=0;index<positions.count;index++) {
      const vertex=new Vector3().fromBufferAttribute(positions,index).applyMatrix4(mesh.matrixWorld);
      if(part.assetId === "lamp_wall") expect(vertex.y).toBeGreaterThan(2.04);
      const hits=new Raycaster(new Vector3(vertex.x,20,vertex.z),new Vector3(0,-1,0),0,30).intersectObjects(roof,false);
      if(!hits.length) continue;
      checked++;
      const underside=hits.at(-1)!.point.y;
      if(vertex.y>underside-.015) penetrations.push({tag:part.tag,vertex:vertex.toArray(),roof:underside});
    }
  }
  expect(checked).toBeGreaterThan(100);
  expect(penetrations.slice(0,5)).toEqual([]);
});
