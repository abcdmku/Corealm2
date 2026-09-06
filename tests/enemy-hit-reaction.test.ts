import { describe, expect, it } from "vitest";
import type { EquipmentBonuses, SemanticEntity, SkillId, Vec3 } from "../game/src/contracts.js";
import { SKILL_IDS, ok } from "../game/src/contracts.js";
import { CREATURE_RUN_SPEED } from "../game/src/app/config.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { Store } from "../game/src/state/store.js";
import { CombatSystem } from "../game/src/systems/combat.js";
import { EnemyAiSystem } from "../game/src/systems/enemyAI.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const NO_GEAR: EquipmentBonuses = { accuracy:0,power:0,armour:0,magicAccuracy:0,magicPower:0,magicArmour:0,vitality:0 };
function fixture(neighbour=false, walkSpeedMps: number|undefined=.6) {
  const store=new Store(7,0), state=store.get(), events=new EventBus();
  state.player.position=[0,0,12];state.player.health=state.player.maxHealth=10000;
  const actor:SemanticEntity={id:"recoil_actor",name:"Recoil",archetype:"enemy",tier:1,regionId:"fallowmarch",position:[0,0,0],state:"alive",interactions:["attack"],
    combat:{health:100,maxHealth:100,level:1,aggroRadius:0,bodyRadius:.4,moveSpeedMps:1.8,...(walkSpeedMps===undefined?{}:{walkSpeedMps})},view:{assetId:"animal_coyote",rotationY:0}};
  const other:SemanticEntity={...actor,id:"recoil_other",archetype:"boss",position:[.2,0,0],combat:{...actor.combat!},view:{...actor.view!}};
  const entities=[actor,...(neighbour?[other]:[])];
  const port={get:(id:string)=>entities.find(e=>e.id===id),all:()=>entities};
  const combat=new CombatSystem({store,events,entities:port,rng:new RngStreams(7),equipment:{totals:()=>NO_GEAR,slots:()=>state.equipment},
    inventory:{addItem:(_id,q)=>ok(q),removeItem:(_id,q)=>ok(q),countItem:()=>0,freeSlots:()=>28,hasRoomFor:()=>true},
    dispatcher:new InteractionDispatcher({get:port.get,playerPosition:()=>state.player.position,skillLevels:()=>Object.fromEntries(SKILL_IDS.map(id=>[id,state.skills[id].level])) as Record<SkillId,number>})});
  for(const e of entities)combat.setEnemyOverride(e.id,{behaviour:"passive",aggroRadius:0});
  const ai=new EnemyAiSystem({store,events,entities:port,combat});
  return {ai,actor,other,state,combat};
}
const displacement=(a:Vec3,b:Vec3)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

describe("enemy movement during nonlethal hit reactions",()=>{
  // The actor's OWN authored pursuit speed, not the shared ceiling: `content/index.ts` solves an
  // animal's `moveSpeedMps` from its walk cycle so its legs stay under the cadence ceiling, and
  // `enemyPursuitSpeedMps` keeps that solution, capping it at CREATURE_RUN_SPEED. This fixture
  // authors 1.8, well under the 4.68 ceiling, so 1.8 is what it must actually travel at.
  const PURSUIT=1.8;
  it("continues pursuit at its own authored run speed through repeated damage",()=>{
    const {ai,actor,combat}=fixture();ai.provoke(actor.id,0);
    expect(PURSUIT).toBeLessThan(CREATURE_RUN_SPEED);
    expect(actor.combat!.moveSpeedMps).toBe(PURSUIT);
    for(let t=100;t<=700;t+=100){
      const before:Vec3=[...actor.position];
      expect(combat.damageEnemy(actor.id,1,t)).toBe(false);
      ai.tick(100,t);
      expect(displacement(before,actor.position)).toBeCloseTo(PURSUIT*.1,8);
      expect(actor.view?.gaitSpeedMps).toBeCloseTo(PURSUIT,8);
      expect(ai.modeOf(actor.id)).toBe("aggro");
    }
    expect(actor.combat!.health).toBe(93);
  });
  it("continues a leashed return through damage",()=>{
    const {ai,actor,state,combat}=fixture();ai.provoke(actor.id,0);
    actor.position=[0,0,35];actor.view!.rotationY=Math.PI;state.player.position=[0,0,34];
    combat.damageEnemy(actor.id,1,100);ai.tick(100,100);
    expect(ai.modeOf(actor.id)).toBe("returning");
    // Home at the speed it chased at, not faster.
    expect(35-actor.position[2]).toBeCloseTo(PURSUIT*.1,8);
  });
  it("preserves the slower explicit idle wandering speed",()=>{
    const {ai,actor}=fixture();let moved=0;
    for(let now=0;now<30000 && !moved;now+=100){const before:Vec3=[...actor.position];ai.tick(100,now);moved=displacement(before,actor.position);}
    expect(moved).toBeCloseTo(.06,8);expect(actor.view?.gaitSpeedMps).toBeCloseTo(.6,8);
  });
  it("preserves the move-speed divided by three walking fallback",()=>{
    const {ai,actor}=fixture();delete actor.combat!.walkSpeedMps;let moved=0;
    for(let now=0;now<30000 && !moved;now+=100){const before:Vec3=[...actor.position];ai.tick(100,now);moved=displacement(before,actor.position);}
    expect(moved).toBeCloseTo(.06,8);expect(actor.view?.gaitSpeedMps).toBeCloseTo(1.8/3,8);
  });
  it("still stops an actor killed during pursuit",()=>{
    const {ai,actor,combat}=fixture();ai.provoke(actor.id,0);ai.tick(100,100);
    const before:Vec3=[...actor.position];expect(combat.damageEnemy(actor.id,100,150)).toBe(true);
    ai.tick(100,200);expect(actor.position).toEqual(before);expect(actor.state).toBe("dead");
  });
});
