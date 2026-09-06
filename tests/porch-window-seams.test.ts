import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { BUILDING_KITS, KIT_IDS, buildPrefab, type PartPlacement } from "../game/src/render/buildings.js";
import { selectedStructureVariantId, structureVariantCount } from "../game/src/render/structures/catalog.js";

const native = new Map<string, BufferGeometry[]>();
const material = new MeshBasicMaterial({side:DoubleSide});
beforeAll(async () => {
  const manifest = JSON.parse(readFileSync(new URL("../game/public/assets/manifest.json",import.meta.url),"utf8")) as {assets:{id:string;file:string}[]};
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
  const ids = new Set(["overhang_brick","wall_bottom_trim","support_beam","lamp_wall",...KIT_IDS.flatMap(id=>[BUILDING_KITS[id].wall,BUILDING_KITS[id].wallWindow,BUILDING_KITS[id].corner])]);
  for (const id of ids) {
    const row = manifest.assets.find(row=>row.id===id)!;
    const document = await io.read(fileURLToPath(new URL(`../game/public/assets/${row.file}`,import.meta.url)));
    const geometries:BufferGeometry[]=[];
    for (const node of document.getRoot().listNodes()) for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const position=primitive.getAttribute("POSITION")!;
      const geometry=new BufferGeometry();
      geometry.setAttribute("position",new BufferAttribute(new Float32Array(position.getArray()!),3));
      const indices=primitive.getIndices();
      if(indices) geometry.setIndex(Array.from(indices.getArray()!));
      geometry.applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix()));
      geometries.push(geometry);
    }
    native.set(id,geometries);
  }
});
function meshes(parts:readonly PartPlacement[]):Mesh[] {
  return parts.flatMap(part=>(native.get(part.assetId) ?? []).map(geometry=>{
    const mesh=new Mesh(geometry,material);
    mesh.position.set(part.dx,part.dy,part.dz);
    mesh.rotation.y=part.rotationY;
    mesh.scale.set(...(part.scaleAxes ?? [1,1,1])); mesh.scale.multiplyScalar(part.scale);
    mesh.updateMatrixWorld(true);return mesh;
  }));
}
function bounds(parts:readonly PartPlacement[]):Box3 {
  const box=new Box3(); for(const mesh of meshes(parts)) box.union(new Box3().setFromObject(mesh)); return box;
}
function hits(parts:readonly PartPlacement[],origin:Vector3,direction:Vector3):boolean {
  return new Raycaster(origin,direction,0,20).intersectObjects(meshes(parts),false).length>0;
}
function nativeSupportGap(support:PartPlacement,roofs:readonly PartPlacement[],x:number,z:number):number {
  const top=new Raycaster(new Vector3(x,10,z),new Vector3(0,-1,0),0,20).intersectObjects(meshes([support]),false)[0];
  if(!top) return Infinity;
  // Allow the same 15 mm seating tolerance below the support top: a slightly embedded post is
  // supported, whereas starting strictly above it can miss a thin roof entirely.
  const ceiling=new Raycaster(new Vector3(x,top.point.y-.015,z),new Vector3(0,1,0),0,5).intersectObjects(meshes(roofs),false)[0];
  if(!ceiling) return Infinity;
  return ceiling.point.y-top.point.y;
}

describe("native porch window panel joins",()=>{
  it.each(KIT_IDS.flatMap(kit=>(["porch","arcade"] as const).map(prefab=>({kit,prefab}))))("seats $kit $prefab main roof on native post tops and rear wall heads",({kit,prefab})=>{
    const parts=buildPrefab(prefab,[6,3],3209081316,kit);
    const roofs=parts.filter(part=>/^b\d+_o$/.test(part.tag));
    const roofBounds=bounds(roofs);
    const measurements:{tag:string;x:number;z:number;gap:number}[]=[];
    for(const post of parts.filter(part=>/^post\d+$/.test(part.tag))) {
      // A carved stone post has a recessed top as well as raised bearing shoulders. Find a real
      // bearing patch in its overlap with the roof, rather than relying on either global bbox
      // extrema or the arbitrary centre of the recessed surface. Every probe still raycasts both
      // native meshes at exactly the same XZ.
      const patch=bounds([post]);
      patch.min.x=Math.max(patch.min.x,roofBounds.min.x);patch.max.x=Math.min(patch.max.x,roofBounds.max.x);
      patch.min.z=Math.max(patch.min.z,roofBounds.min.z);patch.max.z=Math.min(patch.max.z,roofBounds.max.z);
      let best={tag:post.tag,x:post.dx,z:post.dz,gap:Infinity};
      for(let ix=0;ix<9;ix++)for(let iz=0;iz<9;iz++) {
        const x=patch.min.x+(patch.max.x-patch.min.x)*(ix+.5)/9;
        const z=patch.min.z+(patch.max.z-patch.min.z)*(iz+.5)/9;
        const gap=nativeSupportGap(post,roofs,x,z);
        if(gap<best.gap)best={tag:post.tag,x,z,gap};
      }
      measurements.push(best);
    }
    for(const wall of parts.filter(part=>/^b\d+_w$/.test(part.tag))) for(const dx of [-.8,-.4,0,.4,.8]) {
      measurements.push({tag:wall.tag,x:wall.dx+dx,z:wall.dz,gap:nativeSupportGap(wall,roofs,wall.dx+dx,wall.dz)});
    }
    expect(measurements.filter(sample=>sample.gap>.015),JSON.stringify(measurements)).toEqual([]);
  });
  it.each(KIT_IDS.flatMap(kit=>(["porch","arcade"] as const).map(prefab=>({kit,prefab}))))("keeps $kit $prefab window bays on one continuous roof and footing",({kit,prefab})=>{
    for(const footprint of [[6,3],[4,3],[6,2.2],[8,3]] as const) {
      const count=structureVariantCount(prefab,footprint,BUILDING_KITS[kit]);
      for(let seed=0;seed<count;seed++) {
        const variant=selectedStructureVariantId(prefab,footprint,seed,BUILDING_KITS[kit])!;
        if(!/shuttered|paired-windows|watch-window|narrow-back-windows/.test(variant)) continue;
        const parts=buildPrefab(prefab,footprint,seed,kit);
        const roofs=parts.filter(part=>/^b\d+_o$/.test(part.tag));
        const walls=parts.filter(part=>/^b\d+_w$/.test(part.tag));
        const trims=parts.filter(part=>/^b\d+_t$/.test(part.tag));
        const label=`${kit} ${footprint} ${variant}`;
        expect(roofs.length,label).toBe(walls.length);
        expect(trims.length,label).toBe(walls.length);
        expect(roofs.every(part=>part.assetId==="overhang_brick"),label).toBe(true);
        expect(trims.every(part=>part.assetId==="wall_bottom_trim"&&part.dy===0),label).toBe(true);
        const roofBoxes=roofs.map(part=>bounds([part]));
        for(const roof of roofBoxes) {
          expect(roof.min.y,label).toBeCloseTo(roofBoxes[0]!.min.y,4);
          expect(roof.max.y,label).toBeCloseTo(roofBoxes[0]!.max.y,4);
        }
        // Sample real triangles on both sides of every vertical module join, including the
        // formerly exposed wedge above the replaced window. AABB overlap alone cannot prove this.
        for(let index=0;index<walls.length-1;index++) {
          const seam=(walls[index]!.dx+walls[index+1]!.dx)/2;
          for(const dx of [-0.008,0.008]) for(const y of [0.35,1,2,2.75,2.95]) {
            expect(hits(walls,new Vector3(seam+dx,y,-8),new Vector3(0,0,1)),`${label} wall seam x${seam+dx} y${y}`).toBe(true);
          }
          for(const dx of [-0.008,0.008]) for(const z of [-footprint[1]/2+0.1,-footprint[1]/2+1.8]) {
            expect(hits(roofs,new Vector3(seam+dx,10,z),new Vector3(0,-1,0)),`${label} roof seam`).toBe(true);
          }
        }
        for(const wall of walls.filter(part=>part.assetId===BUILDING_KITS[kit].wallWindow)) {
          // The seam repair must retain the native aperture, not hide it behind a solid panel.
          expect(hits([wall],new Vector3(wall.dx,1.8,-8),new Vector3(0,0,1)),`${label} native aperture`).toBe(false);
        }
      }
    }
  });
  it.each(KIT_IDS)("seats %s porch brace heads against the roof and arcade lanterns below it",kit=>{
    for(const prefab of ["porch","arcade"] as const) {
      const count=structureVariantCount(prefab,[6,3],BUILDING_KITS[kit]);
      for(let seed=0;seed<count;seed++) {
        const parts=buildPrefab(prefab,[6,3],seed,kit);
        const roof=bounds(parts.filter(part=>/^b\d+_o$/.test(part.tag)));
        if(prefab==="porch") for(const brace of parts.filter(part=>part.tag.startsWith("v_")&&part.assetId==="support_beam")) {
          const patch=bounds([brace]);let gap=Infinity;
          // A raking brace rises toward one end; its bbox centre is not the bearing head.
          for(const fractionX of [.1,.5,.9])for(let iz=0;iz<=32;iz++) {
            const x=patch.min.x+(patch.max.x-patch.min.x)*fractionX;
            const z=patch.min.z+(patch.max.z-patch.min.z)*(iz+.01)/32.02;
            gap=Math.min(gap,nativeSupportGap(brace,parts.filter(part=>/^b\d+_o$/.test(part.tag)),x,z));
          }
          expect(gap,`${brace.tag} actual head to main roof`).toBeLessThanOrEqual(.015);
          expect(gap,`${brace.tag} seating penetration`).toBeGreaterThanOrEqual(-.015);
        }
        if(prefab==="arcade") for(const lamp of parts.filter(part=>part.assetId==="lamp_wall")) {
          const box=bounds([lamp]);
          expect(box.min.y).toBeCloseTo(2.10,2);
          expect(box.max.y).toBeLessThan(roof.min.y);
        }
      }
    }
  });
});
