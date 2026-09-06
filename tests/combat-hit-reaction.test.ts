import { describe, expect, it } from "vitest";
import { SKILL_IDS, ok, type EquipmentBonuses, type SemanticEntity, type SkillId } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { COMBAT_TICK_MS } from "../game/src/core/time.js";
import { Store } from "../game/src/state/store.js";
import { CombatSystem } from "../game/src/systems/combat.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const NO_GEAR: EquipmentBonuses = { accuracy:0,power:0,armour:0,magicAccuracy:0,magicPower:0,magicArmour:0,vitality:0 };
function fixture(kind: "melee"|"ranged"|"magic" = "melee") {
  const store=new Store(7,0), state=store.get(), events=new EventBus();
  state.player.position=[0,0,0];state.player.health=state.player.maxHealth=10000;
  const enemy:SemanticEntity={id:"recoiling_striker",name:"Striker",archetype:"enemy",tier:1,regionId:"fallowmarch",position:[0,0,1.35],state:"alive",interactions:["attack"],
    combat:{health:100,maxHealth:100,level:1,aggroRadius:0,bodyRadius:.4},view:{assetId:"animal_coyote",rotationY:Math.PI}};
  const entities={get:(id:string)=>id===enemy.id?enemy:undefined,all:()=>[enemy]};
  const combat=new CombatSystem({store,events,entities,rng:new RngStreams(7),meleeTiming:()=>({contactMs:735,recoveryMs:1425}),
    equipment:{totals:()=>NO_GEAR,slots:()=>state.equipment},
    inventory:{addItem:(_id,q)=>ok(q),removeItem:(_id,q)=>ok(q),countItem:()=>0,freeSlots:()=>28,hasRoomFor:()=>true},
    dispatcher:new InteractionDispatcher({get:entities.get,playerPosition:()=>state.player.position,skillLevels:()=>Object.fromEntries(SKILL_IDS.map(id=>[id,state.skills[id].level])) as Record<SkillId,number>})});
  combat.setEnemyOverride(enemy.id,{behaviour:"passive",aggroRadius:0,attackSpeedMs:2400,attackStyle:kind,attackLevel:99,accuracy:999,maxHit:10});
  combat.engageEnemy(enemy.id,0);
  let now=-100;
  const advanceTo=(until:number)=>{while(now+100<=until){now+=100;combat.tick(100,now);}};
  while(!combat.isAttackCommitted(enemy.id) && now<6000)advanceTo(now+100);
  if(!combat.isAttackCommitted(enemy.id))throw new Error('Enemy never committed its first attack');
  return {combat,enemy,state,advanceTo,startedAt:now,now:()=>now};
}

describe("combat continues through nonlethal hit reactions",()=>{
  it.each(["melee","ranged","magic"] as const)("preserves an already committed %s strike after damage",kind=>{
    const {combat,enemy,state,advanceTo,startedAt}=fixture(kind);
    const start=combat.consumeAttackStarts()[0]!;
    expect(start.kind).toBe(kind);
    expect(combat.damageEnemy(enemy.id,1,startedAt+1)).toBe(false);
    expect(combat.isAttackCommitted(enemy.id)).toBe(true);
    expect(enemy.combat!.health).toBe(99);
    advanceTo(Math.ceil(start.contactAtMs/100)*100);
    const contacts=combat.consumeHits().filter(hit=>hit.sourceId===enemy.id);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.atMs).toBe(start.contactAtMs);
    expect(contacts[0]!.kind).toBe(kind);
    expect(state.player.health).toBe(state.player.maxHealth-contacts[0]!.damage);
  });
  it.each(["melee","ranged","magic"] as const)("does not defer later %s strikes while repeatedly damaged",kind=>{
    const {combat,enemy,advanceTo,startedAt}=fixture(kind);
    combat.consumeAttackStarts();
    for(let t=startedAt+100;t<=startedAt+5000;t+=100){combat.damageEnemy(enemy.id,1,t);advanceTo(t);}
    expect(enemy.combat!.health).toBe(50);
    const starts=combat.consumeAttackStarts();
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.every(start=>start.kind===kind)).toBe(true);
    expect(combat.consumeHits().some(hit=>hit.sourceId===enemy.id)).toBe(true);
  });
  it("still cancels a pending strike when its source dies",()=>{
    const {combat,enemy,state,advanceTo,startedAt}=fixture();
    const start=combat.consumeAttackStarts()[0]!;
    expect(combat.damageEnemy(enemy.id,100,startedAt+1)).toBe(true);
    expect(combat.isAttackCommitted(enemy.id)).toBe(false);
    advanceTo(Math.ceil(start.contactAtMs/100)*100);
    expect(combat.consumeHits().filter(hit=>hit.sourceId===enemy.id)).toEqual([]);
    expect(state.player.health).toBe(state.player.maxHealth);
  });
});
