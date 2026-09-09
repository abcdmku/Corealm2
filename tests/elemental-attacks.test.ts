import { describe, expect, it } from "vitest";
import { ELEMENTAL_SPELLS } from "../game/src/content/elementalSpells.js";
import {
  ElementalAttacks,
  planElementalAttack,
  type ElementalTarget,
} from "../game/src/systems/elementalAttacks.js";
import { ElementalSpellVfx } from "../game/src/render/elementalSpellVfx.js";
import * as THREE from "three";

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
  it("binds invocation light to the supplied animated focus and clears every ritual on reset", () => {
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
        vfx.update(null,180);
        expect(vfx.instances).toBe(0);
        expect(vfx.group.userData["elementalArt"].arcane.inscriptions).toBe(0);
        expect(vfx.group.userData["elementalArt"].arcane.cores).toBe(0);
      }
    } finally { vfx.dispose(); }
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
  it("renders air as spatial pressure with no stone, grit or smoke", () => {
    const vfx = new ElementalSpellVfx(new THREE.Group(), () => 0);
    try {
      for (const spell of ELEMENTAL_SPELLS.filter(s => s.element === "wind")) {
        const system = new ElementalAttacks();
        const cast = system.cast(spell.id, [0,0,0], [0,0,10], 0);
        let peakPressure = 0;
        for (let time = 0; time <= system.duration; time += 100) {
          vfx.update(cast,time);
          expect(vfx.solidCount).toBe(0);
          for (const name of ["elemental-3d-fragment", "elemental-3d-smoke"]) {
            const mesh=vfx.group.getObjectByName(name) as THREE.Mesh<THREE.InstancedBufferGeometry>;
            expect(mesh, name).toBeDefined();
            expect(mesh.geometry.instanceCount).toBe(0);
          }
          peakPressure=Math.max(peakPressure,vfx.bodyCount);
          expect(vfx.filamentCount).toBeLessThan(100);
        }
        expect(peakPressure).toBeGreaterThan(0);
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
    system.update(2799, [dummy]);
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
  it("pushes a centred crescent hit sideways and a flood hit downrange", () => {
    const system = new ElementalAttacks(),
      dummy = target(-3);
    system.cast("razor-crescent", [0, 0, 0], [0, 0, 10], 0);
    system.update(700, [dummy]);
    expect(dummy.position[0]).toBeGreaterThan(-3);
    system.reset();
    dummy.position = [-5.25, 0, 6];
    system.cast("deluge", [0, 0, 0], [0, 0, 10], 0);
    system.update(1100, [dummy]);
    expect(dummy.position[0]).toBe(-5.25);
    expect(dummy.position[2]).toBeGreaterThan(6);
  });
  it("carries the phoenix through connected outward and returning flight segments", () => {
    const pulses = planElementalAttack("phoenix-pass", [0, 0, 0], [0, 0, 10]);
    for (let i = 1; i < pulses.length; i++) {
      expect(pulses[i]!.from).toEqual(pulses[i - 1]!.point);
      expect(pulses[i]!.launchAt).toBe(pulses[i - 1]!.at);
    }
    expect(pulses[7]!.point[2]).toBeLessThan(pulses[7]!.from![2]);
  });
});
