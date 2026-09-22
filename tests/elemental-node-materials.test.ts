import * as THREE from "three";
import { expect, it } from "vitest";
import { ElementalParticleCloud } from "../game/src/render/elementalParticleCloud.js";
import { ElementalFilaments } from "../game/src/render/elementalFilaments.js";
import { ElementalEnergyBodies } from "../game/src/render/elementalEnergyBodies.js";
import { ElementalFluidBodies } from "../game/src/render/elementalFluidBodies.js";
import { ElementalFlowSurfaces } from "../game/src/render/elementalFlowSurfaces.js";
import { ElementalVolumes, ElementalSolids } from "../game/src/render/elementalVolumes.js";
import { lowerToWgsl } from "./helpers/wgsl.js";

it("lowers every elemental material variant with live instance geometry",()=>{
  const group=new THREE.Group();
  const effects=[...(["light","smoke","fragment","droplet"] as const).map(kind=>new ElementalParticleCloud(group,kind,4)),
    new ElementalFilaments(group),new ElementalFluidBodies(group),new ElementalFlowSurfaces(group),new ElementalVolumes(group),new ElementalSolids(group),
    ...(["earth","wind","water","fire"] as const).flatMap(element=>[new ElementalEnergyBodies(group,element),new ElementalEnergyBodies(group,element,true)])];
  try {
    let count=0;
    group.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      try {
        const shader=lowerToWgsl(object);
        expect(shader.vertex.length).toBeGreaterThan(200);
        expect(shader.fragment.length).toBeGreaterThan(200);
        expect((object.material as THREE.Material & {isNodeMaterial?:boolean}).isNodeMaterial).toBe(true);
        count++;
      } catch(error) {throw new Error(`${object.name}: ${String(error)}`,{cause:error});}
    });
    expect(count).toBe(27);
  } finally {for(const effect of effects)effect.dispose();}
});
