import * as THREE from "three";
import type { SpellElement, SpellId, SpellRung, Vec3 } from "../contracts.js";
import { SPELL_FLIGHT, spellFlightMs } from "../app/config.js";
import { BASIC_ELEMENTAL_SPELL, BASIC_SPELL_VARIANTS } from "../content/basicSpellVariants.js";
import { ELEMENTAL_SPELLS, type ElementalSpellId } from "../content/elementalSpells.js";
import { elementalDuration } from "../content/elementalFinales.js";
import { planElementalAttack, type ElementalCast } from "../systems/elementalAttacks.js";
import { spellImpactPoint } from "../systems/spellAim.js";
import { BasicElementalVfx } from "./basicElementalVfx.js";
import { ArcaneSpellVfx } from "./arcaneSpellVfx.js";
import { ElementalParticleCloud } from "./elementalParticleCloud.js";
import { ElementalFluidBodies } from "./elementalFluidBodies.js";
import { ElementalSpellVfx } from "./elementalSpellVfx.js";
import { registerMagicGlow } from "./magicGlow.js";

export const ELEMENT_COLOURS:Readonly<Record<SpellElement,{core:number;edge:number}>>={
  wind:{core:0xd5f4ff,edge:0x5d8be5},water:{core:0x80fff0,edge:0x1676ff},
  earth:{core:0xe5efae,edge:0x45d894},fire:{core:0xffe0a0,edge:0xff5b24},
};
export interface SpellVfxDeps {
  parent:THREE.Object3D;camera:THREE.Camera;groundHeightAt?(x:number,z:number):number;
  /** The staff socket the invocation's gathering light binds to, when a rig is drawn. */
  castingFocus?():Vec3|undefined;
}
export interface SpellCastRequest {
  id:string;element:SpellElement;rung:SpellRung;
  /** The spell thrown. An advanced invocation id selects the full lab choreography. */
  spellId?:SpellId;
  /** Muzzle point and target feet. */
  from:Vec3;to:Vec3;impactPoint?:Vec3;hit:boolean;flightMsOverride?:number;
  /** Sim milliseconds per render millisecond, so a scaled harness keeps pulses on their damage. */
  timeScale?:number;
}

/** The elemental id behind a world spell id, when it is one of the twenty advanced invocations. */
export function advancedElementalId(spellId:SpellId|undefined):ElementalSpellId|null {
  if(!spellId)return null;
  const spell=ELEMENTAL_SPELLS.find(s=>s.id===spellId);
  return spell&&spell.rank>0?spell.id:null;
}
class BasicSlot {
  readonly group=new THREE.Group();
  readonly light=new ElementalParticleCloud(this.group,"light",2400);
  readonly fragments=new ElementalParticleCloud(this.group,"fragment",320);
  readonly fluids=new ElementalFluidBodies(this.group);
  readonly basic:BasicElementalVfx;
  readonly arcane:ArcaneSpellVfx;
  readonly unregister:()=>void;
  cast:ElementalCast|null=null;
  id="";element:SpellElement="wind";end=0;
  constructor(parent:THREE.Object3D,ground:(x:number,z:number)=>number){
    this.group.name="basic-spell-cast";parent.add(this.group);
    this.basic=new BasicElementalVfx(this.group,ground,this.light,this.fragments,this.fluids);
    this.arcane=new ArcaneSpellVfx(this.group,ground,this.light);
    this.unregister=registerMagicGlow(this.group);
  }
  update(now:number):void {
    this.light.begin(now/1000,1.15);this.fragments.begin(now/1000);this.fluids.begin(now/1000);
    this.basic.begin(now/1000);this.arcane.begin(now/1000);
    if(this.cast&&now<this.end){this.basic.update(this.cast,now,this.element);this.arcane.update(this.cast,now,this.cast.release);}
    else this.cast=null;
    this.light.end();this.fragments.end();this.fluids.end();this.basic.end();this.arcane.end();
  }
  dispose():void{this.unregister();this.basic.dispose();this.arcane.dispose();this.light.dispose();this.fragments.dispose();this.fluids.dispose();this.group.removeFromParent();}
}

/**
 * The world's invocation layer: one lab renderer, one cast at a time.
 *
 * The full `ElementalSpellVfx` is a heavy object (48k light motes, solids, fluids, filaments), so it
 * is built on the first advanced cast rather than at boot, and a second invocation replaces the
 * first: the combat lock makes overlap impossible for the player anyway.
 */
class AdvancedSlot {
  readonly group=new THREE.Group();
  readonly vfx:ElementalSpellVfx;
  cast:ElementalCast|null=null;
  id="";end=0;
  constructor(parent:THREE.Object3D,ground:(x:number,z:number)=>number,camera:THREE.Camera){
    this.group.name="advanced-spell-cast";parent.add(this.group);
    this.vfx=new ElementalSpellVfx(this.group,ground,camera);
  }
  update(now:number,focus?:Vec3):void {
    if(this.cast&&now>=this.end)this.cast=null;
    this.vfx.update(this.cast,now,[],focus);
  }
  dispose():void{this.vfx.dispose();this.group.removeFromParent();}
}

/** Sixteen auto-cast spells use four sizes of the same four basic production recipes. */
export class SpellVfx {
  private readonly slots:BasicSlot[]=[];
  private advanced:AdvancedSlot|null=null;
  private lastNow=0;
  constructor(private readonly deps:SpellVfxDeps){}
  flightMs(rung:SpellRung,distanceM=0):number{return spellFlightMs(rung,distanceM);}
  cast(request:SpellCastRequest,nowMs:number):void {
    if(this.slots.some(s=>s.cast&&s.id===request.id))return;
    const advancedId=advancedElementalId(request.spellId);
    if(advancedId){this.castAdvanced(advancedId,request,nowMs);return;}
    let slot=this.slots.find(s=>!s.cast||nowMs>=s.end);
    if(!slot&&this.slots.length<4){slot=new BasicSlot(this.deps.parent,this.deps.groundHeightAt??(()=>0));this.slots.push(slot);}
    slot??=this.slots.reduce((a,b)=>a.end<b.end?a:b);
    const ground=this.deps.groundHeightAt??(()=>request.to[1]),variant=BASIC_SPELL_VARIANTS[request.rung];
    const impact=request.impactPoint??spellImpactPoint(request.to);
    const span=Math.hypot(request.to[0]-request.from[0],request.to[2]-request.from[2])||1;
    const fx=(request.to[0]-request.from[0])/span,fz=(request.to[2]-request.from[2])/span;
    const shortfall=request.hit?0:Math.min(1.4,span*.2);
    const aim:Vec3=[request.to[0]-fx*shortfall,ground(request.to[0],request.to[2]),request.to[2]-fz*shortfall];
    const duration=Math.max(90,request.flightMsOverride??this.flightMs(request.rung,span));
    const spellId=BASIC_ELEMENTAL_SPELL[request.element],origin:Vec3=[request.from[0],ground(request.from[0],request.from[2]),request.from[2]];
    const pulses=planElementalAttack(spellId,origin,aim);pulses[0]!.at=duration;
    const release:Vec3=[request.from[0]+fx*.3,request.from[1],request.from[2]+fz*.3];
    slot.cast={id:nowMs,spellId,origin,aim,started:nowMs,pulses,resolved:0,damage:0,hits:0,
      impactHeight:impact[1]-aim[1]-(request.hit?0:.25),release,
      releaseAt:Math.min(SPELL_FLIGHT[request.rung].chargeMs,duration*.5),
      visualScale:variant.size,particleScale:variant.particles,missed:!request.hit};
    slot.id=request.id;slot.element=request.element;slot.end=nowMs+duration+1050;
  }
  /**
   * An advanced invocation, drawn with the lab's own choreography.
   *
   * The pulse plan is the same call `systems/combat.ts` made when it scheduled the damage, from the
   * same two points, so contact frames and health changes agree. `timeScale` stretches the plan
   * onto the render clock the way `flightMsOverride` does for a bolt.
   */
  private castAdvanced(spellId:ElementalSpellId,request:SpellCastRequest,nowMs:number):void {
    if(this.advanced?.cast&&this.advanced.id===request.id)return;
    const ground=this.deps.groundHeightAt??(()=>request.to[1]);
    this.advanced??=new AdvancedSlot(this.deps.parent,ground,this.deps.camera);
    const scale=1/(request.timeScale||1);
    const origin:Vec3=[request.from[0],ground(request.from[0],request.from[2]),request.from[2]];
    const aim:Vec3=[request.to[0],ground(request.to[0],request.to[2]),request.to[2]];
    const pulses=planElementalAttack(spellId,origin,aim);
    const impact=request.impactPoint??spellImpactPoint(request.to);
    const slot=this.advanced;
    slot.cast={id:nowMs,spellId,origin,aim,started:nowMs,pulses,resolved:0,damage:0,hits:0,
      impactHeight:impact[1]-aim[1],missed:!request.hit,presentationScale:scale};
    slot.id=request.id;slot.end=nowMs+elementalDuration(spellId,pulses.at(-1)!.at)*scale;
  }
  update(nowMs:number):void {
    this.lastNow=nowMs;
    for(const slot of this.slots)slot.update(nowMs);
    this.advanced?.update(nowMs,this.deps.castingFocus?.());
  }
  liveParticles():number{
    return this.slots.reduce((n,s)=>n+s.light.instances+s.fragments.instances,0)+(this.advanced?.cast?this.advanced.vfx.particleCount:0);
  }
  drawCalls():number {
    let draws=0;for(const slot of this.slots)slot.group.traverse(o=>{
      const mesh=o as THREE.Mesh<THREE.InstancedBufferGeometry>;
      if(mesh.isMesh&&mesh.visible&&(mesh.geometry.instanceCount===undefined||mesh.geometry.instanceCount>0))draws++;
    });return draws;
  }
  getState(){
    const basics=this.slots.filter(s=>s.cast).map(s=>({id:s.id,element:s.element,spellId:s.cast!.spellId as string,impactHeight:s.cast!.impactHeight,
      size:s.cast!.visualScale,particles:s.light.instances+s.fragments.instances,dropped:s.light.dropped+s.fragments.dropped+s.fluids.dropped+s.basic.dropped+s.arcane.dropped}));
    const a=this.advanced;
    if(a?.cast)basics.push({id:a.id,element:ELEMENTAL_SPELLS.find(s=>s.id===a.cast!.spellId)!.element,spellId:a.cast.spellId,impactHeight:a.cast.impactHeight,
      size:undefined,particles:a.vfx.particleCount,dropped:a.vfx.droppedParticles+a.vfx.droppedFilaments+a.vfx.droppedBodies});
    return basics;
  }
  /** The invocation being drawn right now, for the debug surface and the browser gates. */
  advancedState(){const a=this.advanced;return a?.cast?{spellId:a.cast.spellId,elapsed:this.lastNow-a.cast.started,particles:a.vfx.particleCount,instances:a.vfx.instances}:null;}
  dispose():void {for(const slot of this.slots)slot.dispose();this.slots.length=0;this.advanced?.dispose();this.advanced=null;}
}
