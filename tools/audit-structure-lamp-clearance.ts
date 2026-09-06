/** Read-only CPU screen for authored low lamps outside production solid footprints. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { buildWorld } from "../game/src/world/regionBuilder.js";
import { Solids } from "../game/src/systems/solids.js";
import type { Vec3 } from "../game/src/contracts.js";
const manifest=JSON.parse(readFileSync("game/public/assets/manifest.json","utf8")) as {assets:{id:string;file:string;base:{x:number;y:number;z:number};size:{x:number;y:number;z:number}}[]};
const byId=new Map(manifest.assets.map(asset=>[asset.id,asset]));
const world=buildWorld(1337,()=>0,{
  heightAt:()=>0,baseY:id=>byId.get(id)?.base.y??0,
  assetSize:id=>byId.get(id)?.size??null,
  assetCenterXZ:id=>{const a=byId.get(id);return a?{x:a.base.x+a.size.x/2,z:a.base.z+a.size.z/2}:null;},
});
const io=new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const document=await io.read(`game/public/assets/${byId.get("lamp_wall")!.file}`);
const source:BufferGeometry[]=[];
for(const node of document.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
  const geometry=new BufferGeometry();
  geometry.setAttribute("position",new BufferAttribute(new Float32Array(primitive.getAttribute("POSITION")!.getArray()!),3));
  if(primitive.getIndices())geometry.setIndex(Array.from(primitive.getIndices()!.getArray()!));
  geometry.applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix()));source.push(geometry);
}
const material=new MeshBasicMaterial({side:DoubleSide});
const solids=new Solids(world.solids);
const rows=[];
for(const entity of world.entities.filter(entity=>entity.view?.assetId==="lamp_wall")){
  const view=entity.view!;
  const meshes=source.map(geometry=>{
    const mesh=new Mesh(geometry,material);mesh.position.set(...entity.position);
    mesh.rotation.y=view.rotationY??0;mesh.scale.set(...(view.scaleAxes??[1,1,1]));mesh.scale.multiplyScalar(view.scale??1);
    mesh.updateMatrixWorld(true);return mesh;
  });
  const box=new Box3();for(const mesh of meshes)box.union(new Box3().setFromObject(mesh));
  if(box.min.y>=1.8)continue;
  let exposedPoint:Vec3|null=null;let exposedBottom:number|null=null;
  let blockedPoint:Vec3|null=null;
  for(let ix=0;ix<=16&&!exposedPoint;ix++)for(let iz=0;iz<=24&&!exposedPoint;iz++){
    const x=box.min.x+(box.max.x-box.min.x)*(ix+.5)/17;
    const z=box.min.z+(box.max.z-box.min.z)*(iz+.5)/25;
    const hit=new Raycaster(new Vector3(x,-10,z),new Vector3(0,1,0),0,30).intersectObjects(meshes,false)[0];
    if(!hit||hit.point.y>=1.8)continue;
    const point:Vec3=[x,0,z];const resolved=solids.resolve(point,point,.35);
    if(Math.hypot(resolved[0]-x,resolved[2]-z)<.001){exposedPoint=point;exposedBottom=hit.point.y;}
    else blockedPoint=point;
  }
  const blockingIds = !exposedPoint&&blockedPoint ? world.solids.filter(solid=>{
    const resolved=new Solids([solid]).resolve(blockedPoint!,blockedPoint!,.35);
    return Math.hypot(resolved[0]-blockedPoint![0],resolved[2]-blockedPoint![2])>.001;
  }).map(solid=>solid.id):[];
  rows.push({id:entity.id,name:entity.name,buildingId:entity.meta?.buildingId??null,bottom:box.min.y,position:entity.position,exposedPoint,exposedBottom,blockedPoint,blockingIds,classification:exposedPoint?"open-footprint-under-native-lamp":"blocked-or-no-low-native-surface"});
}
const report={createdAt:new Date().toISOString(),authoredLampCount:world.entities.filter(entity=>entity.view?.assetId==="lamp_wall").length,lowLampCount:rows.length,exposed:rows.filter(row=>row.exposedPoint),blocked:rows.filter(row=>!row.exposedPoint),limitations:["Flat y=0 ground isolates local lamp versus production solids; terrain/routed access require world browser proof.","Actual lamp GLB triangles are sampled vertically across its footprint; obstacle boxes use current production manifest and world builder.","Clear points mean a radius0.35 avatar footprint is not displaced by current global solids, not a proved connected navmesh route."]};
mkdirSync("test-results/finish-structures",{recursive:true});writeFileSync("test-results/finish-structures/lamp-clearance.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
