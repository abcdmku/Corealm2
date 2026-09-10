import { WaterFinaleVfx } from "./waterFinaleVfx.js";
import { elementalChoreographyTime } from "../content/elementalTiming.js";
import * as THREE from "three";
import type { Vec3, SpellElement } from "../contracts.js";
import { elementalSpell } from "../content/elementalSpells.js";
import type {
  ElementalCast,
  ElementalPulse,
  ElementalTarget,
} from "../systems/elementalAttacks.js";
import { ElementalParticleCloud } from "./elementalParticleCloud.js";
import { ElementalSolids, ElementalVolumes } from "./elementalVolumes.js";
import { ElementalFluidBodies } from "./elementalFluidBodies.js";
import { registerMagicGlow } from "./magicGlow.js";
import { ElementalFilaments } from "./elementalFilaments.js";
import { ELEMENTAL_ENERGY } from "./elementalEnergyStyles.js";
import { ElementalSpellArt } from "./elementalSpellArt.js";
import { EarthSpellVfx } from "./earthSpellVfx.js";
import { FireSpellVfx } from "./fireSpellVfx.js";
import { AirSpellVfx } from "./airSpellVfx.js";
import { ElementalFlowSurfaces } from "./elementalFlowSurfaces.js";
import { BasicElementalVfx } from "./basicElementalVfx.js";
import { elementalPulseArt } from "./elementalPulseArt.js";
import { ArcaneSpellVfx } from "./arcaneSpellVfx.js";

const TAU = Math.PI * 2;
const clamp = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
// Stable emission avoids thousands of random hashes per frame.
const random = new Float32Array(16384);
let randomSeed = 917391;
for (let i = 0; i < random.length; i++) {
  randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0;
  random[i] = randomSeed / 4294967296;
}
const rand = (i: number, s = 0): number => random[(i * 37 + s * 131) & 16383]!;

/** Production VFX driven by combat's pulse clock. Every mote occupies a 3D volume.
 * No atlas, billboard or camera-facing geometry is used.
 */
export class ElementalSpellVfx {
  readonly group = new THREE.Group();
  private readonly light: ElementalParticleCloud;
  private readonly smoke: ElementalParticleCloud;
  private readonly fragments: ElementalParticleCloud;
  private readonly volumes: ElementalVolumes;
  private readonly solids: ElementalSolids;
  private readonly fluids: ElementalFluidBodies;
  private readonly filaments: ElementalFilaments;
  private readonly art: ElementalSpellArt;
  private readonly air: AirSpellVfx;
  private readonly earth: EarthSpellVfx;
  private readonly fire: FireSpellVfx;
  private readonly waterFlow: ElementalFlowSurfaces;
  private readonly waterFinale:WaterFinaleVfx;
  private readonly basic: BasicElementalVfx;
  private readonly arcane: ArcaneSpellVfx;
  private readonly pointLights: THREE.PointLight[] = [];
  private palette = ELEMENTAL_ENERGY["air-needle"];
  private element: SpellElement = "earth";
  private hitAreas = false;
  private contactHeight=1.5;
  private readonly unregisterGlow: () => void;
  private readonly choreographyCasts=new WeakMap<ElementalCast,ElementalCast>();
  updateMs = 0;
  constructor(
    parent: THREE.Object3D,
    private readonly ground: (x: number, z: number) => number,
    _camera: THREE.Camera = new THREE.PerspectiveCamera(),
  ) {
    this.group.name = "elemental-spell-effects";
    parent.add(this.group);
    this.unregisterGlow = registerMagicGlow(this.group);
    this.light = new ElementalParticleCloud(this.group, "light", 48000);
    this.fragments = new ElementalParticleCloud(this.group, "fragment", 16000);
    this.smoke = new ElementalParticleCloud(this.group, "smoke", 3000);
    this.volumes = new ElementalVolumes(this.group);
    this.solids = new ElementalSolids(this.group);
    this.fluids = new ElementalFluidBodies(this.group);
    this.basic = new BasicElementalVfx(this.group,ground,this.light,this.fragments,this.fluids);
    this.arcane = new ArcaneSpellVfx(this.group,ground,this.light);
    this.waterFlow = new ElementalFlowSurfaces(this.group);
    this.waterFinale=new WaterFinaleVfx(this.group,ground);
    this.filaments = new ElementalFilaments(this.group);
    this.art = new ElementalSpellArt(this.group, ground);
    this.air = new AirSpellVfx(this.group,ground,this.light,this.filaments,this.fragments,this.smoke);
    this.earth = new EarthSpellVfx(this.group,ground,this.fragments,this.smoke,this.light,this.filaments);
    this.fire = new FireSpellVfx(this.group,ground,this.light,this.smoke,this.filaments,this.volumes,
      (x,y,z,color,intensity,distance)=>this.illuminate(x,y,z,color,intensity,distance));
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 14, 2);
      light.name = "elemental-spell-light";
      this.group.add(light);
      this.pointLights.push(light);
    }
  }
  setHitAreasVisible(visible: boolean): void {
    this.hitAreas = visible;
  }
  get particleCount(): number {
    return (
      this.light.instances + this.fragments.instances + this.smoke.instances + this.waterFinale.particleCount
    );
  }
  get volumeCount(): number {
    return this.volumes.instances + this.fluids.instances;
  }
  get droppedParticles(): number {
    return this.light.dropped + this.fragments.dropped + this.smoke.dropped + this.waterFinale.droppedParticles;
  }
  get solidCount(): number {
    return this.solids.instances + this.earth.fracturePieces + this.basic.solidCount;
  }
  get filamentCount(): number {
    return this.filaments.instances;
  }
  get droppedFilaments(): number {
    return this.filaments.dropped;
  }
  get bodyCount(): number {
    return this.art.instances + this.air.instances + this.earth.instances + this.fire.instances + this.waterFlow.instances + this.waterFinale.instances + this.basic.instances + this.arcane.instances;
  }
  get droppedBodies(): number {
    return this.art.dropped + this.air.dropped + this.fire.dropped + this.earth.dropped + this.waterFlow.dropped + this.waterFinale.dropped + this.basic.dropped + this.fluids.dropped + this.arcane.dropped;
  }
  get instances(): number {
    return (
      this.particleCount +
      this.volumeCount +
      this.solidCount +
      this.filamentCount +
      this.bodyCount
    );
  }
  update(
    cast: ElementalCast | null,
    now: number,
    targets: readonly ElementalTarget[] = [],
    focus?: Vec3,
  ): void {
    const start = performance.now();
    if(cast&&elementalSpell(cast.spellId).rank>0){
      now=elementalChoreographyTime(cast.spellId,(now-cast.started)/(cast.presentationScale??1));
      let authored=this.choreographyCasts.get(cast);
      if(!authored){
        authored={...cast,started:0,pulses:cast.pulses.map(p=>({...p,at:p.choreographyAt??p.at}))};
        this.choreographyCasts.set(cast,authored);
      }
      cast=authored;
    }
    this.contactHeight=cast?.impactHeight??1.5;
    this.element = cast ? elementalSpell(cast.spellId).element : "earth";
    const grounded = this.element === "earth";
    this.light.begin(now / 1000, grounded ? 1.05 : this.element === "fire" ? 1.25 : 1.1);
    this.smoke.begin(now / 1000);
    this.fragments.begin(now / 1000);
    this.volumes.begin(now / 1000, grounded ? .13 : this.element === "water" ? .08 : .24);
    this.solids.begin();
    this.fluids.begin(now / 1000);
    this.waterFlow.begin(now / 1000);
    this.waterFinale.begin(now/1000);
    this.basic.begin(now / 1000);
    this.arcane.begin(now / 1000);
    this.filaments.begin(now / 1000, grounded ? .17 : this.element === "water" ? .13 : .3);
    this.art.begin(now / 1000, cast);
    this.air.begin(now / 1000);
    this.earth.begin(now / 1000);
    this.fire.begin(now / 1000);
    for (const light of this.pointLights) light.intensity = 0;
    if(cast) this.arcane.update(cast,now,focus);
    if (cast && elementalSpell(cast.spellId).rank === 0) this.basic.update(cast,now,this.element);
    else if (cast && this.element === "wind") this.air.update(cast,now);
    else if (cast && this.element === "earth") this.earth.update(cast,now);
    else if (cast && this.element === "fire") this.fire.update(cast,now);
    else if(cast?.spellId==="deluge")this.waterFinale.update(cast,now-cast.started);
    else if (cast) {
      const spell = elementalSpell(cast.spellId),
        age = now - cast.started;
      this.palette = ELEMENTAL_ENERGY[cast.spellId];
      this.waterComposition(cast,age);
      if(cast.spellId==="undertow")this.undertowCollapse(cast,age);

      const vortices = cast.pulses.filter((p) => p.form === "vortex");
      if (vortices.length)
        this.vortex(
          vortices[0]!,
          vortices.at(-1)!.at,
          age,
          spell.element,
          spell.rank,
        );
      for (let i = 0; i < cast.pulses.length; i++)
        this.pulse(cast, cast.pulses[i]!, i, age, spell.element, spell.rank);

    }
    if (cast && this.hitAreas) for (const p of cast.pulses) {
      const local=now-cast.started-p.at;
      if(local>=0&&local<=1050)this.volumes.put("ring",p.point[0],this.ground(p.point[0],p.point[2])+.07,p.point[2],p.radius,p.radius,.16,0xe7ca6c,.9,1,Math.PI/2);
    }
    this.light.end();
    this.fragments.end();
    this.smoke.end();
    this.volumes.end();
    this.solids.end();
    this.fluids.end();
    this.waterFlow.end();
    this.waterFinale.end();
    this.filaments.end();
    this.art.end();
    this.air.end();
    this.fire.end();
    this.earth.end();
    this.basic.end();
    this.arcane.end();
    this.group.userData["elementalArt"]={element:this.element,basic:cast&&elementalSpell(cast.spellId).rank===0?cast.spellId:null,arcane:{...this.arcane.state},waterFinale:{...this.waterFinale.state},air:{...this.air.state},earth:{...this.earth.state},fire:{...this.fire.state},contacts:cast?.pulses.map((_,i)=>elementalPulseArt(cast.spellId,i).name)??[]};
    this.updateMs = performance.now() - start;
  }
  private waterComposition(cast:ElementalCast,age:number):void {
    const t=age/1000;
    for(const [i,p] of cast.pulses.entries()){
      const a=(age-p.at)/1000,[x,,z]=p.point,y=this.ground(x,z),variant=elementalPulseArt(cast.spellId,i);
      if(p.form==="vortex"&&a>=0&&a<.52){
        const contraction=1-a/.52,r=p.radius*(.24+contraction*.65);
        this.waterFlow.put("band","water",x,y+.16,z,r*variant.width,.45*variant.lift,r*variant.depth,
          Math.sin(contraction*Math.PI)*.8,i*11,t*(-1.3-i*.2)+variant.yaw,0,.28,{arc:variant.arc,lean:variant.bend});
      }
      if(p.form==="wave"){
        if(i%4!==0)continue;
        const row=cast.pulses.slice(i,i+4),cx=row.reduce((n,q)=>n+q.point[0],0)/4,cz=row.reduce((n,q)=>n+q.point[2],0)/4;
        const u=(a+.5)/1.35,fade=smooth(u/.2)*(1-smooth((u-.65)/.35));
        if(u<0||u>1)continue;
        const d=p.direction??[0,1],forward=(u-.37)*5,height=p.height*.62*Math.sin(Math.min(1,u*1.5)*Math.PI*.8)*(i===0?.82:i===4?1.13:1);
        // Broken surf fronts leave room between the glowing crest and falling liquid.
        for(let k=0;k<3;k++){
          const side=(k-1)*4.6,stagger=Math.sin(k*2+i)*.65,crest=height*.36*(.8+rand(k,i)*.3);
          const px=cx+d[1]*side+d[0]*(forward+stagger),pz=cz-d[0]*side+d[1]*(forward+stagger);
          this.fluids.put("wave",px,y,pz,2.3+rand(k,i)*.3,crest*fade,1.1*variant.depth,Math.atan2(d[0],d[1]),0,i+k,variant.bend);
          this.waterFlow.put("band","water",px,y+.12,pz,2.8,crest*.65,1.4,fade*.58,i+k,
            Math.atan2(d[0],d[1])+k*.2,0,1,{arc:.48+rand(k,i)*.16,lean:variant.bend});
        }
        continue;
      }
      if(a>=0&&a<1.02&&p.form!=="vortex"&&cast.spellId!=="undertow"){
        const fade=1-smooth((a-.35)/.67),r=p.radius*(.18+1.1*(1-Math.exp(-a*6)));
        this.waterFlow.put("band","water",x,y+.08,z,r*variant.width,(.6+p.radius*.13)*variant.lift,r*variant.depth,fade*.76,i,variant.yaw,0,0,{arc:variant.arc,lean:variant.bend});

        if(p.radius<3&&a<.65)for(let k=0;k<1+i%3;k++){
          const angle=variant.yaw+k*(.8+rand(i,37)*1.7),spread=r*(.26+rand(k,i)*.48);
          this.waterFlow.put("plume","water",x+Math.cos(angle)*spread,y+.06,z+Math.sin(angle)*spread,
            .24+variant.width*.25,(.5+variant.lift*.9)*fade,.24+variant.depth*.22,fade*.64,i*7+k,
            angle,variant.bend*.16,0,{arc:.7,lean:variant.bend});
        }
      }

    }
  }
  private undertowCollapse(cast:ElementalCast,age:number):void {
    const local=(age-cast.pulses.at(-1)!.at)/1000;
    if(local<-.35||local>1.05)return;
    const [x,,z]=cast.aim,y=this.ground(x,z),fade=1-smooth((local-.15)/.9);
    // The eye pinches shut. A low foam crown collapses and drains, without fountain arcs.
    for(let k=0;k<3;k++){
      const radius=(3.3-k*.58)*(1-smooth((local+.35)/.68)),height=.2+Math.sin(clamp((local+.35)/.65)*Math.PI)*.9;
      this.waterFlow.put("band","water",x,y+.08,z,Math.max(.08,radius),height,Math.max(.08,radius*.86),fade*.9,k+70,age*.002+k*1.8,0,0,{arc:.63,lean:.45});
    }
    for(let i=0;i<2400;i++){
      const u=rand(i,92),angle=rand(i,93)*TAU+age*.004,r=(.2+u*3.5)*(1-smooth((local+.35)/.7));
      const bounce=Math.max(0,local)*(.3+rand(i,94)*1.5)-Math.max(0,local)**2*4;
      const py=y+.08+Math.max(0,bounce);
      this.light.put(x+Math.cos(angle)*r,py,z+Math.sin(angle)*r,.014+rand(i,95)*.024,i%5?0x2ca9ef:0xc1fff2,fade*.7,i,1.2,1.5);
      if(i%45===0)this.fluids.put("drop",x+Math.cos(angle)*r,py,z+Math.sin(angle)*r,.035*fade,.05*fade,.035*fade,angle);
    }
  }
  private charge(
    cast: ElementalCast,
    age: number,
    element: SpellElement,
    rank: number,
  ): void {
    const end = Math.min(720, cast.pulses[0]!.at * 0.65),
      t = age / end;
    if (t < 0 || t > 1) return;
    const pal = this.palette,
      fade = Math.sin(t * Math.PI),
      [x, y, z] = cast.origin;
    this.illuminate(x, y + 1.5, z, pal.edge, 24 * fade, 6);
    this.energyOrbit(
      x,
      y + 1.5,
      z,
      0.35 + 0.18 * (1 - t),
      fade,
      age / 1000,
      3,
      true,
    );
    for (let i = 0; i < 380 + rank * 80; i++) {
      const a = rand(i, 1) * TAU + t * (4 + rand(i, 2) * 3),
        r = (0.1 + rand(i, 3) * 0.7) * (1 - t * 0.7),
        h = (rand(i, 4) - 0.5) * 1.3;
      this.light.put(
        x + Math.cos(a) * r,
        y + 1.5 + h * (1 - t),
        z + Math.sin(a) * r,
        0.012 + rand(i, 5) * 0.025,
        i % 5 === 0 ? pal.core : i % 3 === 0 ? pal.secondary : pal.edge,
        fade,
        i,
        1,
        1.7,
      );
    }
    this.volumes.put(
      "sphere",
      x,
      y + 1.5,
      z,
      0.23 + fade * 0.13,
      0.23 + fade * 0.13,
      0.23 + fade * 0.13,
      pal.edge,
      fade * 0.45,
      2,
    );
  }
  private pulse(
    cast: ElementalCast,
    p: ElementalPulse,
    index: number,
    age: number,
    element: SpellElement,
    rank: number,
  ): void {
    const local = age - p.at,
      seed = index + rank * 19,
      [x, , z] = p.point,
      y = this.ground(x, z),
      pal = this.palette;
    if (local > 1080) return;
    if(cast.spellId==="undertow"&&p.form==="nova")return;
    if (["dart", "blade", "beam", "meteor", "wing"].includes(p.form))
      this.projectile(cast, p, index, age, element, rank);
    if (p.form === "wave") this.wave(p, local, seed);
    if (p.form === "mine" && local < 0 && age > 160) {
      const t = clamp(age / p.at),
        r = p.radius * (1 - t * 0.65);
      this.energyOrbit(x, y + 0.06, z, r, 0.6, age / 1000, 3, false);
      this.illuminate(x, y + 0.25, z, pal.secondary, 45 * t * t, 8);
      for (let i = 0; i < 1100; i++) {
        const a = rand(i, seed) * TAU + age * 0.002,
          d = r * Math.sqrt(rand(i, seed + 2)),
          h = rand(i, seed + 1) * 0.22;
        this.light.put(
          x + Math.cos(a) * d,
          y + 0.07 + h,
          z + Math.sin(a) * d,
          0.012 + rand(i, seed + 3) * 0.033,
          i % 6 ? pal.edge : pal.core,
          0.45 + t * 0.5,
          i,
          1,
          1.8,
        );
      }
      this.volumes.put(
        "sphere",
        x,
        y + 0.12,
        z,
        r,
        0.14 + t * 0.24,
        r,
        pal.edge,
        0.38,
        seed,
      );
    }
    if (p.form === "spike") {
      if (element === "earth") this.rockEruption(p, local, seed);
      else this.geyser(p, local, seed,cast.spellId,index);
    }
    if (local >= 0 && local <= 1050) {
      const intensity =
        p.form === "vortex" ? 0.45 : p.form === "wave" ? 0.55 : 1;
      this.impact(p, local, element, seed, intensity, rank);
      if (element === "fire" && p.radius > 1.5) this.fireBody(p, local, seed);

    }
  }
  private projectile(
    cast: ElementalCast,
    p: ElementalPulse,
    index: number,
    age: number,
    element: SpellElement,
    rank: number,
  ): void {
    const meteor = p.form === "meteor",
      big = p.radius > 3,
      launch = p.launchAt ?? Math.max(90, p.at - (meteor ? 1050 : 500)),
      t = (age - launch) / (p.at - launch);
    if (t < 0 || t > 1.24) return;
    const from = p.from ?? cast.origin,
      pal = this.palette,
      seed = index + rank * 71;
    const endY = this.ground(p.point[0], p.point[2]) + (cast.impactHeight??1.5),
      sky = meteor && element === "fire";
    const sx = sky ? p.point[0] - 3 : from[0],
      sy = sky ? endY + p.height : from[1] + 1.45,
      sz = sky ? p.point[2] - 5 : from[2];
    const dx = p.point[0] - sx,
      dy = endY - sy,
      dz = p.point[2] - sz,
      length = Math.hypot(dx, dz) || 1,
      px = dz / length,
      pz = -dx / length;
    const variant=elementalPulseArt(cast.spellId,index);
    const arc = meteor && element === "earth" ? (big ? 7 : 1.6) : 0;
    const head = clamp(t),
      hx = sx + dx * head+px*Math.sin(head*Math.PI)*variant.bend,
      hy = sy + dy * head + Math.sin(head * Math.PI) * (arc+variant.lift*.35),
      hz = sz + dz * head+pz*Math.sin(head*Math.PI)*variant.bend;
    const thickness = meteor
      ? big
        ? 0.65
        : 0.22
      : p.form === "beam"
        ? 0.14
        : p.form === "wing"
          ? 0.4
          : 0.17;
    const count = p.form === "wing" ? 1900 : meteor && big ? 1800 : 850;
    const fade = 1 - smooth((t - 1) / 0.24);
    if(element!=="water")this.travelEnergy(p, t, [sx, sy, sz], [dx, dy, dz], arc, thickness, seed);
    this.art.projectile(p, t, [sx, sy, sz], [dx, dy, dz], arc, element, seed,variant);
    if (t <= 1)
      this.illuminate(
        hx,
        hy,
        hz,
        pal.edge,
        (big ? 100 : 26) * fade,
        big ? 12 : 7,
      );
    for (let i = 0; i < count; i++) {
      const lag = rand(i, seed) * 0.55,
        u = t - lag;
      if (u < 0 || u > 1) continue;
      const distance =
          (0.1 + lag * 1.4) * thickness * Math.sqrt(rand(i, seed + 1)),
        a = rand(i, seed + 2) * TAU + u * 12;
      let x = sx + dx * u + px * (Math.cos(a) * distance+Math.sin(u*Math.PI)*variant.bend),
        y = sy + dy * u + Math.sin(u * Math.PI) * (arc+variant.lift*.35) + Math.sin(a) * distance,
        z = sz + dz * u + pz * (Math.cos(a) * distance+Math.sin(u*Math.PI)*variant.bend);
      const curl = Math.sin(u * 31 + rand(i, seed + 6) * 5) * lag * thickness;
      x += px * curl;
      y += Math.cos(u * 26 + rand(i, seed + 7) * 4) * lag * thickness;
      z += pz * curl;
      if (p.form === "blade") {
        const sweep =
          element === "wind"
            ? (rand(i, seed + 8) - 0.5) * 4.2
            : Math.sin(u * 5 + seed * 0.9) * lag * 2.8;
        const back = element === "wind" ? (sweep / 2.1) ** 2 * 0.9 : 0;
        x += px * sweep - (dx / length) * back;
        z += pz * sweep - (dz / length) * back;
        y +=
          element === "wind"
            ? 0.2 * (1 - (sweep / 2.1) ** 2)
            : Math.sin((lag / 0.55) * Math.PI) * 0.6;
      }
      if (p.form === "wing") {
        const side = i % 2 ? 1 : -1,
          span = rand(i, seed + 9) * 3.7;
        x += px * span * side;
        z += pz * span * side;
        y += Math.sin(span * 0.8 + age * 0.006) * 0.45 + span * 0.24;
        z -= (dz / length) * span * 0.35;
        x -= (dx / length) * span * 0.35;
      }
      this.light.put(
        x,
        y,
        z,
        (0.012 + rand(i, seed + 3) * 0.039) * (i % 11 === 0 ? 2 : 1),
        i % 5 === 0 ? pal.core : i % 3 === 0 ? pal.secondary : pal.edge,
        fade * (1 - lag),
        i,
        0.8 + rand(i, seed + 4) * 1.8,
        i % 5 ? 1.25 : 2.4,
      );
      if (i % 9 === 0 && (element === "fire" || element === "earth"))
        this.smoke.put(
          x,
          y + 0.2,
          z,
          0.07 + lag * 0.45,
          pal.smoke,
          fade * lag * 0.65,
          i,
          1.3,
        );
    }
    if (t <= 1) {
      if(element==="water"){
        this.fluids.put("drop",hx,hy,hz,thickness*.65*variant.width,thickness*.65,thickness*1.5*variant.depth,Math.atan2(dx,dz));

      }else
      this.volumes.put(
        "sphere",
        hx,
        hy,
        hz,
        thickness * 1.9,
        thickness * 1.9,
        thickness * 1.9,
        pal.edge,
        0.7,
        seed,
      );
      if (meteor) {
        const s = big ? Math.min(1.5, p.radius * 0.26) : 0.43;
        this.solids.put(
          "stone",
          hx,
          hy,
          hz,
          s,
          s * 0.85,
          s,
          element === "fire" ? 0x453026 : 0x867d6b,
          age * 0.003,
          1,
        );
        this.volumes.put(
          "sphere",
          hx,
          hy,
          hz,
          s * 1.18,
          s * 1.1,
          s * 1.18,
          pal.edge,
          0.6,
          seed + 21,
        );
        for (let j = 0; j < 650; j++) {
          const a = rand(j, seed + 30) * TAU,
            v = rand(j, seed + 31) * 2 - 1,
            d = s * (0.9 + rand(j, seed + 32) * 0.25),
            ring = Math.sqrt(1 - v * v) * d;
          this.light.put(
            hx + Math.cos(a) * ring,
            hy + v * d,
            hz + Math.sin(a) * ring,
            0.015 + rand(j, seed + 33) * 0.04,
            j % 8 ? pal.edge : pal.core,
            1,
            j,
            1.6,
            1.9,
          );
        }
        for (let j = 0; j < 12; j++) {
          const a = j * 2.4 + age * 0.005,
            d = s * (1 + rand(j, seed) * 0.3);
          this.fragments.put(
            hx + Math.cos(a) * d,
            hy + (rand(j, seed + 1) - 0.5) * s * 2,
            hz + Math.sin(a) * d,
            0.04 + rand(j, seed + 3) * 0.07,
            pal.fragment,
            1,
            j,
          );
        }
      }
      if (p.form === "beam" && element!=="water") {
        const tail = Math.max(0, t - 0.36),
          a: [number, number, number] = [
            sx + dx * tail,
            sy + dy * tail,
            sz + dz * tail,
          ];
        this.volumes.segment(a, [hx, hy, hz], 0.065, pal.core, 0.58, seed);
        if (element === "wind")
          for (let j = 0; j < 6; j++) {
            const u = tail + ((t - tail) * j) / 6,
              v = tail + ((t - tail) * (j + 1)) / 6,
              offset = (rand(j, Math.floor(age / 65) + seed) - 0.5) * 0.9;
            this.volumes.segment(
              [
                sx + dx * u + px * offset,
                sy + dy * u + offset,
                sz + dz * u + pz * offset,
              ],
              [sx + dx * v, sy + dy * v, sz + dz * v],
              0.025,
              pal.core,
              0.9,
              j,
            );
          }
      }
    }
  }
  private impact(
    p: ElementalPulse,
    local: number,
    element: SpellElement,
    seed: number,
    intensity: number,
    rank: number,
  ): void {
    const seconds = local / 1000,
      pal = this.palette,
      [x, , z] = p.point,
      y = this.ground(x, z),
      r = p.radius;
    if(p.form!=="wave"){
      this.impactEnergy(p, seconds, seed, rank, element);
      if(element!=="water")this.art.impact(p, seconds, element, seed);
    }
    this.illuminate(
      x,
      y + 0.7,
      z,
      pal.edge,
      (35 + r * 17) * (1 - smooth(seconds / 0.65)),
      Math.min(18, 5 + r),
    );
    const count = Math.floor(
      (650 + rank * 170 + Math.min(r, 7) * 110) * intensity,
    );
    for (let i = 0; i < count; i++) {
      const birth = rand(i, seed + 2) * 0.16,
        t = seconds - birth,
        life = 0.48 + rand(i, seed + 3) * 0.57;
      if (t < 0 || t > life) continue;
      const a = rand(i, seed) * TAU,
        speed = (0.6 + rand(i, seed + 1) * 2.7) * Math.sqrt(r),
        drag = (1 - Math.exp(-t * 2.3)) / 2.3;
      const elevation = rand(i, seed + 4),
        d =
          (element === "earth" && p.form !== "meteor" ? r * 0.68 : 0) +
          speed * drag * (0.5 + elevation * 0.5),
        v = (1.2 + rand(i, seed + 5) * 5) * Math.sqrt(r) * 0.65;
      const h = Math.max(
        0.025,
        (p.form === "dart" || p.form === "beam"
          ? this.contactHeight
          : element === "earth" && p.form !== "meteor"
            ? p.height * 0.24
            : 0.14) +
          v * t -
          7 * t * t,
      );
      const curl = Math.sin(a * 5 + t * 14) * t * 0.13;
      const px = x + Math.cos(a + curl) * d,
        py = y + h,
        pz = z + Math.sin(a + curl) * d;
      const alpha = Math.pow(1 - t / life, 0.65),
        size =
          (0.012 + Math.pow(rand(i, seed + 6), 2) * 0.048) *
          (1 - smooth((t / life - 0.7) / 0.3));
      if(element==="water"&&p.form!=="wave"&&i%32===0){
        const drop=(.025+rand(i,seed+12)*.022)*alpha;
        this.fluids.put("drop",px,py,pz,drop,drop*(1.3+t),drop,a);
      }
      if (element === "earth" && i % 3 !== 0)
        this.fragments.put(
          px,
          py,
          pz,
          size * (i % 13 === 0 ? 3 : 1),
          i % 4 ? pal.fragment : 0x9a866b,
          1,
          i + t * 3,
        );
      else
        this.light.put(
          px,
          py,
          pz,
          size,
          i % 5 === 0 ? pal.core : i % 3 === 0 ? pal.secondary : pal.edge,
          alpha,
          i + t * 2,
          1 + rand(i, seed + 7) * 2,
          i % 5 ? 1.25 : 2.5,
        );
    }
    // The continuous wave owns its crest and collapse. Damage pockets only shed spray.
    if(p.form==="wave")return;
    const flash = 1 - smooth(seconds / 0.5),
      expansion = smooth(seconds / 0.48),
      fade = 1 - smooth((seconds - 0.35) / 0.65);
    if (r > 1.5 && p.form !== "vortex" && element!=="water") {
      this.volumes.put(
        "sphere",
        x,
        y + 0.1,
        z,
        r * expansion,
        r * expansion * 0.58,
        r * expansion,
        pal.edge,
        fade * 0.18,
        seed,
      );
      this.volumes.put(
        "ring",
        x,
        y + 0.09,
        z,
        r * (0.3 + expansion * 0.9),
        r * (0.3 + expansion * 0.9),
        0.8,
        pal.edge,
        fade * 0.28,
        seed,
        Math.PI / 2,
      );
    }
    this.volumes.put(
      "sphere",
      x,
      y + (r < 1.5 ? 1.2 : 0.3),
      z,
      (0.15 + r * 0.21) * flash,
      (0.2 + r * 0.25) * flash,
      (0.15 + r * 0.21) * flash,
      pal.core,
      flash * 0.7,
      seed + 8,
    );
    if (element === "earth" || element === "fire")
      for (let i = 0; i < (r < 1.5 ? 24 : 90) * intensity; i++) {
        const a = rand(i, seed + 9) * TAU,
          t = seconds - rand(i, seed + 8) * 0.13;
        if (t < 0) continue;
        const d = Math.sqrt(rand(i, seed + 10)) * r * (0.16 + t * 0.82),
          h =
            (0.12 + rand(i, seed + 11) * r * 0.45) *
            Math.sin((clamp(t) * Math.PI) / 2);
        this.smoke.put(
          x + Math.cos(a) * d,
          y + 0.12 + h,
          z + Math.sin(a) * d,
          (0.06 + rand(i, seed + 12) * 0.18) * (1 + t * 2.5),
          pal.smoke,
          fade * (element === "earth" ? .62 : .26),
          i,
          1.2 + rand(i, seed + 13),
        );
      }
    if ((element === "earth" || element === "fire") && r > 2.5)
      for (let i = 0; i < 18; i++) {
        const a = rand(i, seed + 15) * TAU,
          t = seconds,
          d = (0.4 + rand(i, seed + 16) * 1.7) * r * t,
          h = Math.max(0.03, (2 + rand(i, seed + 17) * 4) * t - 5 * t * t),
          s =
            (0.06 + rand(i, seed + 18) * 0.17) *
            (1 - smooth((seconds - 0.7) / 0.35));
        this.solids.put(
          "stone",
          x + Math.cos(a) * d,
          y + h,
          z + Math.sin(a) * d,
          s,
          s * 0.85,
          s,
          pal.fragment,
          seed + i + t * 6,
          2,
        );
      }
  }
  private fireBody(p: ElementalPulse, local: number, seed: number): void {
    const t = local / 1000,
      fade = (1 - smooth((t - 0.28) / 0.65)) * smooth(t / 0.09),
      [x, , z] = p.point,
      y = this.ground(x, z);
    const height = Math.min(8, p.height * 0.6) * smooth(t / 0.16),
      radius = p.radius * 0.5;
    this.plumeEnergy(x, y, z, radius, height, t, fade, seed, "flame");
    for (let i = 0; i < 1300; i++) {
      const u = (rand(i, seed + 40) + t * 0.6) % 1,
        a = rand(i, seed + 41) * TAU + t * 3 + u * 7;
      const r = radius * (1 - u) * Math.sqrt(rand(i, seed + 42)),
        h = u * height;
      this.light.put(
        x + Math.cos(a) * r,
        y + 0.08 + h,
        z + Math.sin(a) * r,
        (0.018 + rand(i, seed + 43) * 0.045) * fade,
        i % 9 === 0
          ? this.palette.core
          : i % 3
            ? this.palette.edge
            : this.palette.secondary,
        fade * smooth(u / 0.08) * (1 - smooth((u - 0.65) / 0.35)),
        i,
        1.2 + u * 2,
        1.3,
      );
      if (i % 8 === 0)
        this.smoke.put(
          x + Math.cos(a) * r * 1.2,
          y + 0.25 + h * 0.7,
          z + Math.sin(a) * r * 1.2,
          (0.07 + rand(i, seed + 44) * 0.16) * fade,
          0x3c332d,
          fade * 0.4,
          i,
          1.5,
        );
    }
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4 + t,
        r = radius * rand(i, seed + 46) * 0.65,
        h = height * (0.5 + rand(i, seed + 45) * 0.5),
        w = (0.25 + rand(i, seed + 47) * 0.35) * Math.sqrt(radius);
      this.volumes.put(
        "sphere",
        x + Math.cos(a) * r,
        y + h * 0.45,
        z + Math.sin(a) * r,
        w,
        h * 0.58,
        w,
        i % 3 ? this.palette.edge : this.palette.secondary,
        fade * 0.16,
        seed + i,
        Math.sin(a) * 0.2,
        t,
        Math.cos(a) * 0.2,
      );
    }
  }
  private vortex(
    p: ElementalPulse,
    last: number,
    age: number,
    element: SpellElement,
    rank: number,
  ): void {
    const lead = Math.min(800, p.at * 0.6),
      local = age - p.at;
    if (age < p.at - lead || age > last + 1000) return;
    const fade =
        smooth((local + lead) / lead) * (1 - smooth((age - last - 300) / 700)),
      pal = this.palette,
      water = element === "water";
    const [x, , z] = p.point,
      y = this.ground(x, z),
      height = water ? 1.7 : Math.min(12, p.height),
      radius = p.radius * (water ? 1 : 0.65),
      time = age / 1000;
    this.plumeEnergy(
      x,
      y,
      z,
      radius,
      height,
      time,
      fade,
      17,
      water ? "whirlpool" : "vortex",
    );
    this.illuminate(x, y + 1, z, pal.edge, 80 * fade, 12);
    const count = rank === 5 ? 6400 : 4200;
    for (let i = 0; i < count; i++) {
      const u = (rand(i, 21) + time * (water ? 0.12 : 0.3)) % 1,
        a = rand(i, 22) * TAU + time * (water ? -3.5 : 4.2) + u * 7;
      const envelope = water ? (1 - u) * 0.9 + 0.07 : 0.15 + u * 0.85;
      const r = radius * envelope * (0.5 + Math.sqrt(rand(i, 23)) * 0.5),
        turb =
          Math.sin(a * 4 + u * 17 - time * 4) * 0.13 +
          Math.sin(a * 9 - u * 25) * 0.07;
      const px = x + Math.cos(a) * (r + turb),
        pz = z + Math.sin(a) * (r + turb),
        py =
          y +
          0.12 +
          (water ? Math.sin(u * Math.PI) * 0.85 : u * height) +
          Math.cos(a * 3 + time * 2) * 0.12;
      const s = (0.013 + rand(i, 24) * 0.04) * fade;
      this.light.put(
        px,
        py,
        pz,
        s,
        i % 7 === 0 ? pal.core : i % 3 ? pal.edge : pal.secondary,
        fade * (0.5 + rand(i, 25) * 0.5),
        i,
        1 + rand(i, 26) * 2,
        1.3,
      );
      if (i % 40 === 0 && water)
        this.fluids.put("drop",px,py,pz,s*1.2,s*1.7,s*1.2,time);
      if (!water && i % 12 === 0)
        this.smoke.put(
          px,
          py,
          pz,
          0.09 + rand(i, 27) * 0.15,
          pal.smoke,
          fade * (0.55 - u * 0.3),
          i + time,
          1.8,
        );
    }
    if (water) {
      this.waterFlow.put("band","water",x,y+.12,z,radius,.5,radius,fade*.60,41,-time*.45,0,0,{arc:.64});
      this.waterFlow.put("band","water",x,y+.22,z,radius*.68,.4,radius*.68,fade*.50,17,time*.3,0,0,{arc:.48});
    } else {
      for (let i = 0; i < 3; i++)
        this.volumes.put(
          "funnel",
          x,
          y + height / 2,
          z,
          radius * (0.8 + i * 0.1),
          height,
          radius * (0.8 + i * 0.1),
          i === 1 ? pal.core : pal.edge,
          fade * 0.06,
          i * 7,
          0,
          time * (i % 2 ? 1 : -1),
        );
    }
  }
  private rockEruption(p: ElementalPulse, local: number, seed: number): void {
    if (local < -180 || local > 1050) return;
    const [x, , z] = p.point,
      y = this.ground(x, z),
      rise = smooth((local + 100) / 260),
      sink = smooth((local - 540) / 510),
      size = rise * (1 - sink);
    const height = Math.min(6.3, p.height * 0.66),
      count = p.height > 7 ? 13 : 9;
    this.fractureEnergy(x, y, z, p.radius * 1.45, size, seed);
    for (let i = 0; i < count; i++) {
      const a = rand(i, seed) * TAU,
        d = i === 0 ? 0 : Math.sqrt(rand(i, seed + 1)) * p.radius * 0.7;
      const h = height * (i === 0 ? 1 : 0.13 + rand(i, seed + 2) * 0.35) * size,
        w = (i === 0 ? height * 0.25 : 0.35 + rand(i, seed + 3) * 0.6) * size;
      this.solids.put(
        "stone",
        x + Math.cos(a) * d,
        y + h * 0.39 - 0.15,
        z + Math.sin(a) * d,
        w,
        h * 0.58,
        w * 0.8,
        i % 3 ? 0xb4ab98 : 0x918e84,
        seed + i,
        0.25 + rand(i, seed + 4) * 0.3,
      );
      if (i % 2 === 0)
        this.volumes.put(
          "sphere",
          x + Math.cos(a) * d,
          y + 0.15,
          z + Math.sin(a) * d,
          w * 1.25,
          0.18,
          w * 1.25,
          this.palette.edge,
          size * 0.35,
          seed + i,
        );
    }
    if (local >= 0)
      for (let i = 0; i < 380; i++) {
        const t = local / 1000,
          a = rand(i, seed + 7) * TAU,
          d = rand(i, seed + 8) * p.radius * (0.4 + t),
          h = Math.max(0.025, (2 + rand(i, seed + 9) * height) * t - 6 * t * t);
        this.fragments.put(
          x + Math.cos(a) * d,
          y + h,
          z + Math.sin(a) * d,
          (0.015 + rand(i, seed + 10) * 0.06) * size,
          0x5a5146,
          1,
          i + t * 3,
        );
      }
  }
  private geyser(p: ElementalPulse, local: number, seed: number,spellId:ElementalCast["spellId"],index:number): void {
    if (local < -200 || local > 1000) return;
    const variant=elementalPulseArt(spellId,index);
    const t = (local + 200) / 1000,
      [x, , z] = p.point,
      y = this.ground(x, z),
      fade = 1 - smooth((local - 400) / 600),
      growth = smooth((local + 200) / 330),
      height = p.height * growth * variant.lift * .57;
    for(let k=0;k<3;k++){
      const angle=variant.yaw+k*2.4,r=.55+k*.28,px=x+Math.cos(angle)*r,pz=z+Math.sin(angle)*r;
      this.fluids.put("jet",px,y,pz,.40*fade,height*fade*(.62+k*.12),.40*fade,angle,.13,index+k,variant.bend+k*.3);
      this.waterFlow.put("plume","water",px,y,pz,.33,height*fade*(.60+k*.10),.33,fade*.45,seed+k,angle,.12,0,{arc:.45,lean:1});
    }
    for (let i = 0; i < 1900; i++) {
      const u = (rand(i, seed) + t * 0.65) % 1,
        a = rand(i, seed + 1) * TAU + u * 9 + t * 4,
        d = (0.1 + u * u * 0.9) * p.radius * Math.sqrt(rand(i, seed + 2));
      const h = Math.max(0.04, 4 * u * (1 - u) * height);
      const spill=variant.bend*u*u*1.2;
      if (i % 16 === 0) {
        const drop = (.025 + rand(i,seed+7)*.04) * fade;
        this.fluids.put("drop",x+Math.cos(a)*d*variant.width+spill,y+h,z+Math.sin(a)*d*variant.depth,drop,drop*(1.3+Math.abs(1-u*2)),drop, a);
      }
      this.light.put(
        x + Math.cos(a) * d * variant.width + spill,
        y + h,
        z + Math.sin(a) * d * variant.depth,
        (0.014 + rand(i, seed + 3) * 0.04) * fade,
        i % 4 === 0
          ? this.palette.core
          : i % 3
            ? this.palette.edge
            : this.palette.secondary,
        fade * smooth(u / 0.07) * (1 - smooth((u - 0.8) / 0.2)),
        i,
        1.8,
        1.25,
      );
    }
  }
  private wave(p: ElementalPulse, local: number, seed: number): void {
    if (local < -500 || local > 850) return;
    const t = (local + 500) / 1350,
      fade = smooth(t / 0.2) * (1 - smooth((t - 0.65) / 0.35)),
      [x, , z] = p.point,
      y = this.ground(x, z),
      d = p.direction ?? [0, 1];
    const forward = (t - 0.37) * 5,
      height = p.height * 0.25 * Math.sin(Math.min(1, t * 1.5) * Math.PI * 0.8);
    for (let i = 0; i < 1100; i++) {
      const a = ((rand(i, seed) + t * 0.7) % 1) * Math.PI * 1.3,
        span = (rand(i, seed + 1) - 0.5) * 3.7,
        r = 0.3 + rand(i, seed + 2) * 0.6;
      const along = forward + Math.cos(a) * r,
        h =
          0.12 +
          Math.sin(a) *
            height *
            (0.4 + r * 0.6) *
            (0.88 + Math.sin(span * 3 + t * 6) * 0.12);
      const spray = i % 5 === 0 ? rand(i, seed + 3) * 0.8 : 0;
      if (i % 32 === 0) {
        const drop = (.025 + rand(i,seed+7)*.035) * fade;
        this.fluids.put("drop", x+d[1]*span+d[0]*along, y+Math.max(.04,h+spray), z-d[0]*span+d[1]*along,
          drop,drop*1.5,drop, t);
      }
      this.light.put(
        x + d[1] * span + d[0] * along,
        y + Math.max(0.04, h + spray),
        z - d[0] * span + d[1] * along,
        (0.009 + rand(i, seed + 4) * 0.028) * fade,
        i % 6 === 0
          ? this.palette.core
          : i % 3
            ? this.palette.edge
            : this.palette.secondary,
        fade * 0.8,
        i,
        1.8,
        1.25,
      );
    }
  }
  private plumeEnergy(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    time: number,
    alpha: number,
    seed: number,
    kind: "flame" | "jet" | "vortex" | "whirlpool",
  ): void {
    this.art.field(x, y, z, radius, height, time, alpha, seed, kind);
    const pal = this.palette,
      count = kind === "vortex" ? 8 : kind === "whirlpool" ? 6 : 5;
    for (let k = 0; k < count; k++) {
      const phase = rand(k, seed + 80) * TAU,
        speed = 0.7 + rand(k, seed + 81) * 0.8;
      let ax = 0,
        ay = 0,
        az = 0;
      for (let j = 0; j <= 22; j++) {
        const u = j / 22;
        let a =
          phase +
          u * (kind === "whirlpool" ? 8 : kind === "jet" ? 1.8 : 5.5) +
          time * (kind === "whirlpool" ? -2.5 : 3) * speed;
        let r = radius * (0.3 + rand(k, seed + 82) * 0.7),
          h = height * u;
        if (kind === "vortex") r *= 0.16 + u * 0.84;
        else if (kind === "whirlpool") {
          r *= 1 - u * 0.9;
          h = 0.1 + Math.sin(u * Math.PI) * 0.6;
        } else if (kind === "flame") {
          r *= 1 - u * 0.87;
          h *= 0.65 + rand(k, seed + 83) * 0.35;
          a += Math.sin(u * 13 - time * 6 + k) * 0.16;
        } else {
          r *= 0.07 + u * u * 1.5;
          h = 4 * u * (1 - u) * height * (0.75 + rand(k, seed + 83) * 0.25);
        }
        const turbulent =
          Math.sin(u * 19 - time * 7 + phase) * Math.sin(u * Math.PI) * 0.12;
        const bx = x + Math.cos(a) * (r + turbulent),
          by =
            y +
            0.06 +
            h +
            (kind === "vortex" ? Math.sin(a * 3 + u * 6) * 0.16 : 0),
          bz = z + Math.sin(a) * (r + turbulent);
        const visibility = alpha * (0.45 + 0.55 * Math.sin(u * Math.PI));
        if (j)
          this.filaments.segment(
            ax,
            ay,
            az,
            bx,
            by,
            bz,
            k % 5 === 0 ? 0.012 : 0.007,
            k % 5 === 0 ? pal.core : k % 3 ? pal.edge : pal.secondary,
            visibility * 0.65,
            k,
            u - 1 / 22,
            u,
          );
        ax = bx;
        ay = by;
        az = bz;
      }
    }
  }
  private fractureEnergy(
    x: number,
    y: number,
    z: number,
    radius: number,
    alpha: number,
    seed: number,
  ): void {
    const pal = this.palette;
    for (let k = 0; k < 9; k++) {
      const a = (k * TAU) / 9 + rand(k, seed + 90) * 0.35;
      let ax = x,
        ay = y + 0.035,
        az = z;
      for (let j = 1; j <= 6; j++) {
        const u = j / 6,
          d = u * radius * (0.6 + rand(k, seed + 91) * 0.4),
          bend = (rand(j, k + seed) - 0.5) * 0.4;
        const bx = x + Math.cos(a + bend) * d,
          bz = z + Math.sin(a + bend) * d,
          by = this.ground(bx, bz) + 0.035;
        this.filaments.segment(
          ax,
          ay,
          az,
          bx,
          by,
          bz,
          0.008 + (1 - u) * 0.012,
          k % 3 ? pal.edge : pal.secondary,
          alpha * 0.9,
          k,
          u - 1 / 6,
          u,
        );
        if (j === 3 || j === 5) {
          const cx = bx + Math.cos(a + 0.9) * radius * 0.22,
            cz = bz + Math.sin(a + 0.9) * radius * 0.22;
          this.filaments.segment(
            bx,
            by,
            bz,
            cx,
            this.ground(cx, cz) + 0.035,
            cz,
            0.006,
            pal.core,
            alpha * 0.6,
            k,
            0.45,
            0.95,
          );
        }
        ax = bx;
        ay = by;
        az = bz;
      }
    }
  }
  private illuminate(
    x: number,
    y: number,
    z: number,
    hex: number,
    intensity: number,
    distance: number,
  ): void {
    intensity *= this.element === "earth" ? .12 : this.element === "fire" ? .7 : .3;
    let light = this.pointLights[0]!;
    for (const candidate of this.pointLights)
      if (candidate.intensity < light.intensity) light = candidate;
    if (intensity <= light.intensity) return;
    light.position.set(x, y, z);
    light.color.setHex(hex);
    light.intensity = intensity;
    light.distance = distance;
  }
  private energyOrbit(
    x: number,
    y: number,
    z: number,
    radius: number,
    alpha: number,
    time: number,
    rings: number,
    standing: boolean,
  ): void {
    const pal = this.palette;
    for (let k = 0; k < rings; k++) {
      let ax = 0,
        ay = 0,
        az = 0;
      for (let j = 0; j <= 36; j++) {
        const u = j / 36,
          a = u * TAU + time * (k % 2 ? 1.5 : -1.1),
          r =
            radius * (1 - k * 0.17) * (1 + Math.sin(a * 5 + time * 4) * 0.035);
        const x1 = x + Math.cos(a) * r,
          z1 = z + Math.sin(a) * r,
          y1 =
            y +
            (standing
              ? Math.sin(a + k * 1.2) * r * 0.65
              : Math.sin(a * 3 + time) * 0.025);
        if (j)
          this.filaments.segment(
            ax,
            ay,
            az,
            x1,
            y1,
            z1,
            0.006 + k * 0.002,
            k === 0 ? pal.core : k % 2 ? pal.edge : pal.secondary,
            alpha * 0.7,
            k,
            u - 1 / 36,
            u,
          );
        ax = x1;
        ay = y1;
        az = z1;
      }
    }
  }
  private travelEnergy(
    p: ElementalPulse,
    t: number,
    start: Vec3,
    delta: Vec3,
    arc: number,
    width: number,
    seed: number,
  ): void {
    if (p.form === "blade") return;
    const pal = this.palette,
      fade = 1 - smooth((t - 1) / 0.24),
      count = p.form === "meteor" ? 6 : 4;
    const length = Math.hypot(delta[0], delta[2]) || 1,
      px = delta[2] / length,
      pz = -delta[0] / length;
    for (let k = 0; k < count; k++) {
      const phase = rand(k, seed + 61) * TAU,
        head = Math.min(1, t),
        tail = Math.max(0, t - 0.68),
        spread = k === 0 ? 0 : width * (0.7 + rand(k, seed + 62));
      let ax = 0,
        ay = 0,
        az = 0;
      for (let j = 0; j <= 14; j++) {
        const s = j / 14,
          u = tail + (head - tail) * s,
          a = phase + u * (12 + rand(k, seed + 63) * 10),
          r = spread * (1.2 - s * 0.85);
        let x = start[0] + delta[0] * u + px * Math.cos(a) * r,
          y =
            start[1] +
            delta[1] * u +
            Math.sin(u * Math.PI) * arc +
            Math.sin(a) * r,
          z = start[2] + delta[2] * u + pz * Math.cos(a) * r;
        if (j)
          this.filaments.segment(
            ax,
            ay,
            az,
            x,
            y,
            z,
            k === 0 ? 0.018 + width * 0.02 : 0.006 + rand(k, seed + 64) * 0.013,
            k === 0 ? pal.core : k % 3 ? pal.edge : pal.secondary,
            fade * (k === 0 ? 0.75 : 0.55),
            k,
            s - 1 / 14,
            s,
            k === 0 ? 1.1 : 1,
          );
        ax = x;
        ay = y;
        az = z;
      }
    }
  }

  private impactEnergy(
    p: ElementalPulse,
    t: number,
    seed: number,
    rank: number,
    element: SpellElement,
  ): void {
    const pal = this.palette,
      [x, , z] = p.point,
      y = this.ground(x, z),
      r = p.radius;
    if (t < 0.02 || t > 0.78 || p.form === "vortex") return;
    const fade = 1 - smooth((t - 0.22) / 0.56),
      count =
        element === "wind" ? 4 + rank : element === "earth" ? 6 : 8 + rank;
    for (let k = 0; k < count; k++) {
      const a = rand(k, seed + 70) * TAU,
        speed = (3 + rand(k, seed + 71) * 8) * Math.sqrt(r),
        vertical =
          (1 + rand(k, seed + 72) * 6) *
          Math.sqrt(r) *
          (element === "earth" ? 0.3 : element === "wind" ? 0.5 : 1);
      let ax = 0,
        ay = 0,
        az = 0;
      for (let j = 0; j <= 5; j++) {
        const u = j / 5,
          age = Math.max(0, t - (1 - u) * 0.13),
          d = ((1 - Math.exp(-age * 2.3)) / 2.3) * speed;
        const h = Math.max(
            0.05,
            (p.form === "dart" || p.form === "beam" ? 1.2 : 0.1) +
              vertical * age -
              7 * age * age,
          ),
          curl = Math.sin(age * 11 + k) * age * 0.12;
        const bx = x + Math.cos(a + curl) * d,
          by = y + h,
          bz = z + Math.sin(a + curl) * d;
        if (j)
          this.filaments.segment(
            ax,
            ay,
            az,
            bx,
            by,
            bz,
            0.005 + rand(k, seed + 73) * 0.009,
            k % 4 === 0 ? pal.core : k % 3 ? pal.edge : pal.secondary,
            fade * 0.8,
            k,
            u - 0.2,
            u,
          );
        ax = bx;
        ay = by;
        az = bz;
      }
    }
    if (r > 1.5) {
      const radius = r * (0.2 + smooth(t / 0.5));
      this.energyOrbit(x, y + 0.045, z, radius, fade * 0.65, t, 1, false);
    }
  }
  dispose(): void {
    this.unregisterGlow();
    this.light.dispose();
    this.smoke.dispose();
    this.fragments.dispose();
    this.volumes.dispose();
    this.solids.dispose();
    this.fluids.dispose();
    this.waterFlow.dispose();
    this.waterFinale.dispose();
    this.basic.dispose();
    this.arcane.dispose();
    this.filaments.dispose();
    this.art.dispose();
    this.air.dispose();
    this.earth.dispose();
    this.fire.dispose();
    this.group.removeFromParent();
  }
}
