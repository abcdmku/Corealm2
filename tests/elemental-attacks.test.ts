import { describe, expect, it } from "vitest";
import { ELEMENTAL_SPELLS } from "../game/src/content/elementalSpells.js";
import {
  ElementalAttacks,
  planElementalAttack,
  type ElementalTarget,
} from "../game/src/systems/elementalAttacks.js";
import { ElementalSpellVfx } from "../game/src/render/elementalSpellVfx.js";
import * as THREE from "three";
import { elementalGameplayTime, elementalChoreographyTime } from "../game/src/content/elementalTiming.js";
import { FINALE } from "../game/src/content/elementalFinales.js";
import { tornadoDebris } from "../game/src/render/tornadoDebris.js";
import { FracturedBoulder } from "../game/src/render/fracturedBoulder.js";

const target = (x = 0, z = 10): ElementalTarget => ({
  id: "dummy",
  position: [x, 0, z],
  health: 1000,
  maxHealth: 1000,
  hits: 0,
  status: null,
  statusUntil: 0,
});

describe("elemental attacks", () => {
  it("lands boulder fragments on the terrain plane when contact is above a tall target",()=>{
    const body=new FracturedBoulder(new THREE.Group(),72,"landing-test",()=>2);
    try{
      const shader={uniforms:{},vertexShader:"#include <begin_vertex>",fragmentShader:""} as THREE.WebGLProgramParametersWithUniforms;
      body.mesh.material.onBeforeCompile(shader,{} as THREE.WebGLRenderer);
      const depth={uniforms:{},vertexShader:"#include <begin_vertex>",fragmentShader:"#include <alphatest_fragment>"} as THREE.WebGLProgramParametersWithUniforms;
      body.mesh.customDepthMaterial!.onBeforeCompile(depth,{} as THREE.WebGLRenderer);
      for(const height of [3.5,7])for(const scale of [.19,.28]){
        body.pose(0,height,10,scale,.5,.8,1);
        expect(shader.uniforms["rockFloor"]!.value*scale+body.mesh.position.y).toBeCloseTo(2);
      }
      for(const fade of [1,.4,.05]){
        body.pose(0,7,10,.28,.5,.8,fade);
        expect(depth.uniforms['fractureFade']!.value).toBe(body.mesh.material.opacity);
      }
    }finally{body.dispose();}
  });
  it("keeps area contact prompt while allowing Deluge to gather, with art aligned to damage",()=>{
    for(const spell of ELEMENTAL_SPELLS.filter(s=>s.rank>=2)){
      const system=new ElementalAttacks(),dummy=target(),cast=system.cast(spell.id,[0,0,0],[0,0,10],500);
      expect(cast.pulses[0]!.at).toBeLessThanOrEqual(spell.id==='deluge'?1250:1100);
      for(const p of cast.pulses)expect(elementalChoreographyTime(spell.id,p.at)).toBeCloseTo(p.choreographyAt!);
      system.update(500+cast.pulses[0]!.at-1,[dummy]);expect(cast.resolved).toBe(0);
      system.update(500+cast.pulses[0]!.at,[dummy]);expect(cast.resolved).toBeGreaterThan(0);
      const last=cast.pulses.at(-1)!;
      expect(elementalChoreographyTime(spell.id,last.at+900)-elementalChoreographyTime(spell.id,last.at+800)).toBeCloseTo(100);
    }
  });
  it("gives the two implosions a readable gathering window before their sharp collapse",()=>{
    expect(elementalGameplayTime('deluge',3300)-elementalGameplayTime('deluge',1650)).toBeGreaterThanOrEqual(500);
    expect(elementalGameplayTime('mountainfall',FINALE.mountainfall.collapse)-elementalGameplayTime('mountainfall',3295)).toBeGreaterThanOrEqual(500);
    for(const id of ['deluge','mountainfall'] as const){
      const last=planElementalAttack(id,[0,0,0],[0,0,10]).at(-1)!;
      expect(last.at).toBeLessThan(2000);
      expect(elementalChoreographyTime(id,last.at)).toBeCloseTo(last.choreographyAt!);
    }
  });
  it("keeps finales active through their aftermath and drops every tornado grain onto terrain",()=>{
    for(const id of ["skybreaker","deluge","mountainfall","starfall"] as const){
      const system=new ElementalAttacks(),dummy=target(),cast=system.cast(id,[0,0,0],[0,0,10],0);
      expect(system.duration-cast.pulses.at(-1)!.at).toBeGreaterThanOrEqual(2400);
      expect(cast.pulses[0]!.at).toBeLessThanOrEqual(id==='deluge'?1250:1100);
      system.update(cast.pulses.at(-1)!.at,[dummy]);const hits=dummy.hits;
      expect(()=>system.cast(id,[0,0,0],[0,0,10],system.duration-1)).toThrow();
      system.update(system.duration,[dummy]);expect(dummy.hits).toBe(hits);
    }
    const ground=(x:number,z:number)=>2+x*.01+z*.02;
    const landingRadii:number[]=[];
    for(let i=0;i<2800;i+=17){
      const before=tornadoDebris(i,FINALE.skybreaker.release,0,10,ground);
      const released=tornadoDebris(i,FINALE.skybreaker.release+1,0,10,ground);
      expect(new THREE.Vector3(...before.position).distanceTo(new THREE.Vector3(...released.position))).toBeLessThan(.02);
      const landed=tornadoDebris(i,6600,0,10,ground);
      expect(landed.settled).toBe(true);expect(landed.alpha).toBeGreaterThan(.9);
      expect(landed.position[1]).toBeCloseTo(ground(landed.position[0],landed.position[2])+.025);
      landingRadii.push(Math.hypot(landed.position[0],landed.position[2]-10));
      expect(tornadoDebris(i,FINALE.skybreaker.end,0,10,ground).alpha).toBe(0);
    }
    expect(Math.min(...landingRadii)).toBeLessThan(2.5);
    expect(Math.max(...landingRadii)).toBeGreaterThan(11);
    expect(landingRadii.filter(r=>r<4).length).toBeGreaterThan(15);
  });
  it("surrounds the water area before converging and throwing the collision upward",()=>{
    const vfx=new ElementalSpellVfx(new THREE.Group(),()=>0),cast=new ElementalAttacks().cast("deluge",[0,0,0],[0,0,10],0);
    try{
      vfx.update(cast,elementalGameplayTime("deluge",1500));
      const waves=vfx.group.getObjectByName("elemental-deluge-continuous-surf") as THREE.Mesh<THREE.BufferGeometry>;
      expect(waves.visible).toBe(true);
      const positions=waves.geometry.getAttribute('position');
      const poses=Array.from({length:positions.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(positions,i));
      expect(poses.some(p=>p.x>8)).toBe(true);expect(poses.some(p=>p.x< -8)).toBe(true);
      expect(poses.some(p=>p.z>8)).toBe(true);expect(poses.some(p=>p.z< -8)).toBe(true);
      const crestHeights=poses.filter((_,i)=>i>=8*81&&i<9*81).map(p=>p.y);
      expect(Math.max(...crestHeights)-Math.min(...crestHeights)).toBeGreaterThan(1);
      expect((vfx.group.getObjectByName("elemental-fluid-wave") as THREE.InstancedMesh).count).toBe(0);
      const outer=vfx.group.userData["elementalArt"].waterFinale.radius;
      const collision=vfx.group.getObjectByName("elemental-deluge-turbulent-collision") as THREE.Mesh<THREE.BoxGeometry>;
      expect(collision.visible).toBe(false);
      vfx.update(cast,elementalGameplayTime("deluge",3100));expect(vfx.group.userData["elementalArt"].waterFinale.radius).toBeLessThan(outer*.45);
      vfx.update(cast,elementalGameplayTime("deluge",FINALE.deluge.contact+2*FINALE.deluge.rowGap+250));
      expect(waves.visible).toBe(false);expect(vfx.group.userData["elementalArt"].waterFinale.splashHeight).toBeGreaterThan(5);
      const splash=vfx.group.getObjectByName("elemental-deluge-torn-splash") as THREE.Mesh<THREE.BufferGeometry>;
      expect(splash.visible).toBe(true);
      expect(collision.visible).toBe(true);
      expect(collision.geometry.index!.count/3).toBe(12);
      expect(collision.userData['magicGlow']).toBe(false);
      const sections=splash.geometry.getAttribute('splashLobe'),splashPositions=splash.geometry.getAttribute('position'),indices=splash.geometry.index!;
      const heights=new Map<number,number>();
      for(let i=0;i<sections.count;i++)heights.set(sections.getX(i),Math.max(heights.get(sections.getX(i))??0,splashPositions.getY(i)));
      expect(heights.size).toBeGreaterThan(4);
      expect(Math.max(...heights.values())-Math.min(...heights.values())).toBeGreaterThan(3.5);
      expect(indices.count/3).toBeLessThanOrEqual(2880);
      // No triangles may reconnect the separated sheets into a conical wall.
      for(let i=0;i<indices.count;i+=3){
        expect(sections.getX(indices.getX(i))).toBe(sections.getX(indices.getX(i+1)));
        expect(sections.getX(indices.getX(i))).toBe(sections.getX(indices.getX(i+2)));
      }
      expect((vfx.group.getObjectByName("elemental-fluid-jet") as THREE.InstancedMesh).count).toBe(0);
      const drops=vfx.group.getObjectByName("elemental-3d-deluge-droplets") as THREE.Mesh<THREE.InstancedBufferGeometry,THREE.ShaderMaterial>;
      expect(drops.visible).toBe(true);
      expect(drops.geometry.instanceCount).toBeGreaterThan(2000);
      expect(drops.userData['magicGlow']).toBe(false);
      expect(drops.userData['magicGlowOnly']).toBe(false);
      expect(drops.material.blending).toBe(THREE.NormalBlending);
      vfx.update(null,7000);
      expect(collision.visible).toBe(false);
      expect(drops.visible).toBe(false);expect(drops.geometry.instanceCount).toBe(0);
      expect(vfx.particleCount).toBe(0);
    }finally{vfx.dispose();}
  });
  it("moves earth ridges inward before their fragments leave the compressed formation",()=>{
    const vfx=new ElementalSpellVfx(new THREE.Group(),()=>0),cast=new ElementalAttacks().cast("mountainfall",[0,0,0],[0,0,10],0);
    try{
      vfx.update(cast,elementalGameplayTime("mountainfall",3500));
      expect(vfx.group.children.filter(m=>m.name.startsWith('elemental-mountain-fracture-outcrop-')&&m.visible)).toHaveLength(5);
      const currents=vfx.group.getObjectByName('elemental-earth-mineral-currents') as THREE.Mesh<THREE.InstancedBufferGeometry>;
      expect(currents.geometry.instanceCount).toBeGreaterThanOrEqual(7);
      const rock=vfx.group.getObjectByName("elemental-mountain-fracture-outcrop-0") as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
      const outer=rock.position.distanceTo(new THREE.Vector3(0,rock.position.y,10));
      vfx.update(cast,elementalGameplayTime("mountainfall",4250));
      expect(rock.visible).toBe(true);expect(rock.position.distanceTo(new THREE.Vector3(0,rock.position.y,10))).toBeLessThan(outer*.4);
      const scale=rock.scale.clone();
      vfx.update(cast,elementalGameplayTime("mountainfall",4800));expect(rock.visible).toBe(true);expect(rock.scale.equals(scale)).toBe(true);
      expect(vfx.particleCount).toBeGreaterThan(5000);
      expect(vfx.group.userData['elementalArt'].earth.boulderPieces).toBeLessThanOrEqual(72);
      expect(vfx.group.userData['elementalArt'].earth.boulderPieces).toBeGreaterThan(0);
      const shader={uniforms:{},vertexShader:"#include <begin_vertex>",fragmentShader:"#include <alphatest_fragment>"} as THREE.WebGLProgramParametersWithUniforms;
      rock.customDepthMaterial!.onBeforeCompile(shader,{} as THREE.WebGLRenderer);
      vfx.update(cast,elementalGameplayTime("mountainfall",6300));
      const local=new THREE.Vector3(.3,.6,-.4);
      const roundTrip=local.clone().applyMatrix4(rock.matrixWorld).applyMatrix4(shader.uniforms['rockInverseModel']!.value);
      expect(roundTrip.distanceTo(local)).toBeLessThan(.00001);
      expect(shader.uniforms['fractureFade']!.value).toBe(rock.material.opacity);
      expect(rock.material.opacity).toBeGreaterThan(0);expect(rock.material.opacity).toBeLessThan(1);
      const ridge=vfx.group.getObjectByName('elemental-fault-travelling-ridge') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
      expect(rock.material.customProgramCacheKey()).not.toBe(ridge.material.customProgramCacheKey());
      vfx.update(cast,elementalGameplayTime("mountainfall",6700));expect(rock.visible).toBe(false);
    }finally{vfx.dispose();}
  });
  it("binds casting light to the animated focus without inscription meshes and clears it on reset", () => {
    const vfx = new ElementalSpellVfx(new THREE.Group(), () => 0);
    try {
      for (const spell of ELEMENTAL_SPELLS) {
        const cast = new ElementalAttacks().cast(spell.id, [0,0,0], [0,0,10], 0);
        const focus: [number,number,number] = [1.25,2.15,.4];
        vfx.update(cast,160,[],focus);
        const cores=vfx.group.getObjectByName("elemental-arcane-concentrated-foci") as THREE.InstancedMesh;
        const matrix=new THREE.Matrix4(); cores.getMatrixAt(0,matrix);
        const position=new THREE.Vector3().setFromMatrixPosition(matrix);
        expect(position.distanceTo(new THREE.Vector3(...focus))).toBeLessThan(.00001);
        expect(vfx.group.userData["elementalArt"].arcane.rite).toBe(spell.id);
        expect(vfx.group.userData["elementalArt"].arcane.inscriptions).toBe(0);
        vfx.group.traverse(object=>expect(object.name).not.toContain("inscription"));
        vfx.update(null,180);
        expect(vfx.instances).toBe(0);
        expect(vfx.group.userData["elementalArt"].arcane.inscriptions).toBe(0);
        expect(vfx.group.userData["elementalArt"].arcane.cores).toBe(0);
      }
    } finally { vfx.dispose(); }
  });
  it("keeps airborne mineral cores small inside an active magical wake",()=>{
    const vfx=new ElementalSpellVfx(new THREE.Group(),()=>0);
    try{for(const [id,name,maxSize] of [
      ["flint-shot","elemental-flint-connected-fracture",.25],
      ["siege-boulder","elemental-siege-connected-fracture",.55],
    ] as const){
      const cast=new ElementalAttacks().cast(id,[0,0,0],[0,0,10],0);
      for(const fraction of [.45,.7,.9]){
        vfx.update(cast,elementalGameplayTime(id,cast.pulses[0]!.choreographyAt!*fraction));
        const rock=vfx.group.getObjectByName(name)!;
        expect(rock.visible).toBe(true);
        expect(Math.max(rock.scale.x,rock.scale.y,rock.scale.z)).toBeLessThan(maxSize);
        const wake=vfx.group.getObjectByName("elemental-magic-swooshes") as THREE.Mesh<THREE.InstancedBufferGeometry>;
        expect(wake.geometry.instanceCount).toBeGreaterThan(0);
      }
    }}finally{vfx.dispose();}
  });
  it("keeps six distinct patterns per element with bounded effects and a finite end", () => {
    for (const element of ["wind", "water", "earth", "fire"])
      expect(
        ELEMENTAL_SPELLS.filter((spell) => spell.element === element),
      ).toHaveLength(6);
    const signatures = new Set<string>();
    const vfx = new ElementalSpellVfx(new THREE.Group(), () => 0);
    for (const spell of ELEMENTAL_SPELLS) {
      const system = new ElementalAttacks(),
        dummy = target();
      const cast = system.cast(spell.id, [0, 0, 0], [0, 0, 10], 0);
      signatures.add(JSON.stringify(cast.pulses));
      system.update(cast.pulses[0]!.at - 1, [dummy]);
      expect(dummy.health).toBe(1000);
      let peakParticles = 0;
      for (let time = 0; time < system.duration; time += 50) {
        system.update(time, [dummy]);
        vfx.update(cast, time);
        peakParticles = Math.max(peakParticles, vfx.particleCount);
        expect(vfx.particleCount).toBeLessThanOrEqual(67000);
        expect(vfx.droppedParticles, `${spell.id} at ${time} ms`).toBe(0);
        expect(vfx.droppedFilaments, `${spell.id} strands at ${time} ms`).toBe(
          0,
        );
        expect(vfx.filamentCount).toBeLessThanOrEqual(4096);
        expect(
          vfx.droppedBodies,
          `${spell.id} energy bodies at ${time} ms`,
        ).toBe(0);
        expect(vfx.bodyCount).toBeLessThanOrEqual(256);
        expect(vfx.volumeCount).toBeLessThanOrEqual(704);
        expect(vfx.solidCount).toBeLessThanOrEqual(1600);
      }
      expect(peakParticles).toBeGreaterThanOrEqual(
        spell.rank===0||spell.element === "wind" ? 100 : spell.rank === 5 ? 5000 : 700,
      );
      expect(dummy.health).toBeLessThan(1000);
      system.update(10000, [dummy]);
      expect(dummy.status).toBeNull();
      const hits = dummy.hits;
      system.update(10001, [dummy]);
      expect(dummy.hits).toBe(hits);
      vfx.update(cast, 10000);
      expect(vfx.instances).toBe(0);
    }
    expect(signatures.size).toBe(24);
    vfx.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.computeBoundingBox();
        const size = object.geometry.boundingBox!.getSize(new THREE.Vector3());
        expect(Math.min(size.x, size.y, size.z), object.name).toBeGreaterThan(
          0.01,
        );
      }
      expect(object instanceof THREE.Sprite).toBe(false);
    });
    vfx.dispose();
  });
  it("keeps small air spells clean and adds bounded lifted debris to large storms", () => {
    const vfx = new ElementalSpellVfx(new THREE.Group(), () => 0);
    try {
      for (const spell of ELEMENTAL_SPELLS.filter(s => s.element === "wind")) {
        const system = new ElementalAttacks();
        const cast = system.cast(spell.id, [0,0,0], [0,0,10], 0);
        let peakPressure = 0,peakDebris=0;
        for (let time = 0; time <= system.duration; time += 100) {
          vfx.update(cast,time);
          expect(vfx.solidCount).toBe(0);
          for (const name of ["elemental-3d-fragment", "elemental-3d-smoke"]) {
            const mesh=vfx.group.getObjectByName(name) as THREE.Mesh<THREE.InstancedBufferGeometry>;
            expect(mesh, name).toBeDefined();
            const count=mesh.geometry.instanceCount;
            if(spell.rank<3)expect(count).toBe(0);
            else peakDebris=Math.max(peakDebris,count);
          }
          peakPressure=Math.max(peakPressure,vfx.bodyCount);
          expect(vfx.filamentCount).toBeLessThan(100);
        }
        expect(peakPressure).toBeGreaterThan(0);
        if(spell.rank>=3)expect(peakDebris).toBeGreaterThan(100);
      }
    } finally { vfx.dispose(); }
  });
  it("keeps the four starters to one small hit and a short, light effect",()=>{
    const basics=ELEMENTAL_SPELLS.filter(s=>s.rank===0);
    expect(new Set(basics.map(s=>s.element)).size).toBe(4);
    const vfx=new ElementalSpellVfx(new THREE.Group(),()=>0);
    try{for(const spell of basics){
      const system=new ElementalAttacks(),centre=target(),neighbour=target(1.1);
      const cast=system.cast(spell.id,[0,0,0],[0,0,10],0);
      expect(cast.pulses).toHaveLength(1);
      expect(cast.pulses[0]!.at).toBeLessThan(600);
      for(let time=0;time<system.duration;time+=25){
        system.update(time,[centre,neighbour]);vfx.update(cast,time);
        expect(vfx.particleCount).toBeLessThan(500);
        expect(vfx.bodyCount).toBeLessThan(8);
      }
      expect(centre.hits).toBe(1);expect(neighbour.hits).toBe(0);
      vfx.update(cast,system.duration);expect(vfx.instances).toBe(0);
    }}finally{vfx.dispose();}
  });
  it("keeps Skybreaker's broad funnel separate from Vacuum Coil's low spiral eye",()=>{
    const vfx=new ElementalSpellVfx(new THREE.Group(),()=>0);
    try{for(const id of ["skybreaker","vacuum-coil"] as const){
      const cast=new ElementalAttacks().cast(id,[0,0,0],[0,0,10],0);
      vfx.update(cast,cast.pulses[0]!.at+120);
      const mesh=vfx.group.getObjectByName("elemental-air-pressure-funnel") as THREE.InstancedMesh;
      const matrix=new THREE.Matrix4(),scale=new THREE.Vector3();
      if(id==="skybreaker"){
        expect(mesh.count).toBeGreaterThan(0);mesh.getMatrixAt(0,matrix);scale.setFromMatrixScale(matrix);
        const foot=mesh.geometry.getAttribute("pressureLife").getZ(0);
        expect(foot).toBeGreaterThan(.6);expect(scale.x*foot*2).toBeGreaterThan(11);
      }else{
        expect(mesh.count).toBe(0);
        const spiral=vfx.group.getObjectByName("elemental-air-current-spiral") as THREE.InstancedMesh;
        expect(spiral.count).toBeGreaterThan(0);
        spiral.getMatrixAt(0,matrix);scale.setFromMatrixScale(matrix);
        expect(scale.y).toBeLessThan(3.2);expect(scale.x).toBeGreaterThan(4);
      }
    }}finally{vfx.dispose();}
  });
  it("keeps every water attack liquid and replaces freezing with wet slows or stagger", () => {
    const vfx = new ElementalSpellVfx(new THREE.Group(), () => 0);
    try {
      for (const spell of ELEMENTAL_SPELLS.filter(s => s.element === "water")) {
        const system = new ElementalAttacks(), dummy=target();
        const cast=system.cast(spell.id,[0,0,0],[0,0,10],0);
        expect(cast.pulses.every(p=>p.status!=="freeze")).toBe(true);
        for(let time=0;time<=system.duration;time+=100){
          system.update(time,[dummy]);vfx.update(cast,time,[dummy]);
          expect(vfx.solidCount,spell.id).toBe(0);
          expect(dummy.status).not.toBe("freeze");
        }
      }
    } finally {vfx.dispose();}
  });
  it("does not hit outside the radius and does not resolve an impact twice", () => {
    const system = new ElementalAttacks(),
      centre = target(),
      outside = target(2);
    system.cast("air-needle", [0, 0, 0], [0, 0, 10], 100);
    system.update(699, [centre, outside]);
    expect(centre.hits).toBe(0);
    system.update(700, [centre, outside]);
    system.update(800, [centre, outside]);
    expect(centre.health).toBe(982);
    expect(centre.hits).toBe(1);
    expect(outside.health).toBe(1000);
  });
  it("pulls toward the aim and reset cancels pending mine damage", () => {
    const system = new ElementalAttacks(),
      dummy = target(4);
    system.cast("vacuum-coil", [0, 0, 0], [0, 0, 10], 0);
    system.update(650, [dummy]);
    expect(dummy.position[0]).toBeCloseTo(2.9);
    system.reset();
    const health = dummy.health;
    system.cast("cinder-mine", [0, 0, 0], [0, 0, 10], 1000);
    system.update(1000+planElementalAttack("cinder-mine",[0,0,0],[0,0,10])[0]!.at-1, [dummy]);
    expect(dummy.health).toBe(health);
    system.reset();
    system.update(4000, [dummy]);
    expect(dummy.health).toBe(health);
  });
  it("rotates attack lanes with the aim and rejects replacement during a cast", () => {
    const north = planElementalAttack("faultline", [0, 0, 0], [0, 0, 10]);
    const east = planElementalAttack("faultline", [0, 0, 0], [10, 0, 0]);
    expect(north.map((p) => p.point[2])).toEqual(east.map((p) => p.point[0]));
    const system = new ElementalAttacks();
    system.cast("air-needle", [0, 0, 0], [0, 0, 10], 0);
    expect(() => system.cast("starfall", [0, 0, 0], [0, 0, 10], 1)).toThrow(
      "Wait",
    );
  });
  it("pushes a centred crescent hit sideways and converges a flood hit toward its centre", () => {
    const system = new ElementalAttacks(),
      dummy = target(-3);
    system.cast("razor-crescent", [0, 0, 0], [0, 0, 10], 0);
    system.update(700, [dummy]);
    expect(dummy.position[0]).toBeGreaterThan(-3);
    system.reset();
    dummy.position = [6, 0, 10];
    system.cast("deluge", [0, 0, 0], [0, 0, 10], 0);
    system.update(elementalGameplayTime("deluge",FINALE.deluge.contact), [dummy]);
    expect(dummy.position[0]).toBeLessThan(6);
    expect(dummy.position[2]).toBeCloseTo(10);
  });
  it("replaces the returning phoenix with separate ground vents and gives Sunfall one hit",()=>{
    const vents=planElementalAttack("phoenix-pass",[0,0,0],[0,0,10]);
    expect(vents).toHaveLength(7);
    expect(new Set(vents.map(p=>p.point.join(","))).size).toBe(7);
    expect(vents.every(p=>p.form==="spike"&&!p.from)).toBe(true);
    const sun=planElementalAttack("starfall",[0,0,0],[0,0,10]);
    expect(sun).toHaveLength(1);expect(sun[0]!.damage).toBe(110);expect(sun[0]!.radius).toBe(9);
    const undertow=planElementalAttack("undertow",[0,0,0],[0,0,10]);
    expect(undertow.at(-1)!.form).toBe("nova");
    expect(undertow.some(p=>p.form==="spike")).toBe(false);
  });
});
