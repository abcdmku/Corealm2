import {describe,it,expect} from "vitest";
import * as THREE from "three";
import { SpellVfx } from "../game/src/render/spellVfx.js";
import { SPELLS } from "../game/src/content/spells.js";
import { spellImpactPoint } from "../game/src/systems/spellAim.js";
import { SPELL_RUNGS, type SpellRung } from "../game/src/contracts.js";
import { SPELL_FLIGHT } from "../game/src/app/config.js";
import { basicSpellPath } from "../game/src/render/basicSpellPath.js";

const harness=()=>new SpellVfx({parent:new THREE.Group(),camera:new THREE.PerspectiveCamera(),groundHeightAt:()=>2});
describe("basic spell replacement",()=>{
  it("arcs every basic body and magical wake together while retaining the release and hit points",()=>{
    const parent=new THREE.Group(),vfx=new SpellVfx({parent,camera:new THREE.PerspectiveCamera(),groundHeightAt:()=>2});
    const matrix=new THREE.Matrix4(),position=new THREE.Vector3();
    try{for(const spell of SPELLS){
      const duration=vfx.flightMs(spell.rung,12),releaseAt=Math.min(SPELL_FLIGHT[spell.rung].chargeMs,duration*.5);
      vfx.cast({id:spell.id,element:spell.element,rung:spell.rung,from:[0,3.2,0],to:[0,2,12],impactPoint:[0,5,12],hit:true},0);
      vfx.update(releaseAt+(duration-releaseAt)*.5);
      const basic=parent.getObjectByName("basic-spell-cast")!;
      const expected=new THREE.Vector3(0,4.1+11.7*.24,6.15);
      if(spell.element==="fire"){
        const flame=basic.getObjectByName("elemental-basic-flame") as THREE.Mesh<THREE.InstancedBufferGeometry>;
        position.fromBufferAttribute(flame.geometry.getAttribute('curveD'),0);
      }else{
        const core=basic.getObjectByName("elemental-arcane-concentrated-foci") as THREE.InstancedMesh;
        core.getMatrixAt(core.count-1,matrix);position.setFromMatrixPosition(matrix);
      }
      expect(position.distanceTo(expected),spell.id).toBeLessThan(.0001);
      if(spell.element==="wind")position.copy(basic.getObjectByName("elemental-basic-pressure")!.position);
      if(spell.element==="water"){
        (basic.getObjectByName("elemental-fluid-drop") as THREE.InstancedMesh).getMatrixAt(0,matrix);position.setFromMatrixPosition(matrix);
      }
      if(spell.element==="earth")position.copy(basic.getObjectByName("elemental-basic-pebble")!.position);
      expect(position.distanceTo(expected),`${spell.id} body stays inside its wake`).toBeLessThan(.0001);
      vfx.update(duration+2000);
    }}finally{vfx.dispose();}
    for(const impact of [[0,5,12],[2,1,1],[0,3.2,0]] as const){
      const path=basicSpellPath([0,3.2,0],impact);
      expect(path(0)).toEqual([0,3.2,0]);expect(path(1)).toEqual([...impact]);
      expect(path(-.1)).toEqual(path(0));expect(path(1.2)).toEqual(path(1));
      expect(path(.5).every(Number.isFinite)).toBe(true);
    }
  });
  it("aims 75% up short and tall rendered bodies on raised terrain",()=>{
    expect(spellImpactPoint([0,2,10],{min:[-1,2,9],max:[1,3,11]})).toEqual([0,2.75,10]);
    expect(spellImpactPoint([0,2,10],{min:[-1,2,9],max:[1,8,11]})).toEqual([0,6.5,10]);
    expect(spellImpactPoint([0,2,10])).toEqual([0,3.5,10]);
  });
  it("renders all sixteen spells through basic recipes with finite pools and full cleanup",()=>{
    const vfx=harness();
    try{for(const spell of SPELLS){
      const total=vfx.flightMs(spell.rung,12);let peak=0,flight=0,impact=0;
      vfx.cast({id:spell.id,element:spell.element,rung:spell.rung,from:[0,3.2,0],to:[0,2,12],impactPoint:[0,5,12],hit:true},0);
      for(let t=0;t<total+1100;t+=25){
        vfx.update(t);peak=Math.max(peak,vfx.liveParticles());
        if(t<total)flight=Math.max(flight,vfx.liveParticles());else impact=Math.max(impact,vfx.liveParticles());
        for(const state of vfx.getState()){expect(state.dropped,spell.id).toBe(0);expect(state.impactHeight).toBe(3);}
        expect(vfx.liveParticles()).toBeLessThan(2720);
      }
      expect(peak).toBeGreaterThan(200);expect(flight).toBeGreaterThan(0);expect(impact).toBeGreaterThan(0);
      vfx.update(total+2000);expect(vfx.liveParticles()).toBe(0);expect(vfx.drawCalls()).toBe(0);
    }}finally{vfx.dispose();}
  });
  it("adds size and particles by tier and makes misses smaller than hits",()=>{
    const vfx=harness();
    const sweep=(rung:SpellRung,hit=true)=>{
      const total=vfx.flightMs(rung,12);let peak=0;
      vfx.cast({id:`${rung}-${hit}`,element:"fire",rung,from:[0,3,0],to:[0,2,12],hit},0);
      for(let t=total;t<total+1100;t+=25){vfx.update(t);peak=Math.max(peak,vfx.liveParticles());}
      vfx.update(total+2000);return peak;
    };
    try{const peaks=SPELL_RUNGS.map(r=>sweep(r));for(let i=1;i<peaks.length;i++)expect(peaks[i]!).toBeGreaterThan(peaks[i-1]!*1.35);
      expect(sweep("surge",false)).toBeLessThan(peaks[3]!*.5);
    }finally{vfx.dispose();}
  });
  it("deduplicates launch events, bounds overlapping casts and disposes meshes",()=>{
    const parent=new THREE.Group(),vfx=new SpellVfx({parent,camera:new THREE.PerspectiveCamera(),groundHeightAt:()=>0});
    for(let i=0;i<12;i++)vfx.cast({id:String(i),element:"water",rung:"surge",from:[0,1.2,0],to:[0,0,12],hit:true},i);
    vfx.cast({id:"11",element:"water",rung:"surge",from:[0,1.2,0],to:[0,0,12],hit:true},12);
    expect(vfx.getState()).toHaveLength(4);vfx.update(700);
    expect(vfx.liveParticles()).toBeLessThanOrEqual(10880);expect(vfx.getState().every(s=>s.dropped===0)).toBe(true);
    vfx.update(5000);expect(vfx.liveParticles()).toBe(0);vfx.dispose();expect(parent.children).toHaveLength(0);
  });
});
