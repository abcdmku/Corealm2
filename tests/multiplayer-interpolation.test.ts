import {expect,it} from "vitest";
import {ActorInterpolation,followReplicatedActor} from "../game/src/multiplayer/interpolation.js";

it("keeps position and heading continuous when another packet arrives mid-blend",()=>{
  const motion=new ActorInterpolation([0,0,0],0);
  motion.push([1,0,0],0,1);
  expect(motion.sample(50)[0]).toBe(.5);
  expect(motion.facing(50)).toBe(.5);
  motion.push([2,0,0],50,2);
  expect(motion.sample(50)[0]).toBe(.5);
  expect(motion.facing(50)).toBe(.5);
  expect(motion.sample(100)[0]).toBe(1.25);
  expect(motion.facing(100)).toBe(1.25);
});
it("turns across the angle seam by the short arc",()=>{
  const motion=new ActorInterpolation([0,0,0],Math.PI-.1);
  motion.push([0,0,0],0,-Math.PI+.1);
  expect(motion.facing(50)).toBeCloseTo(Math.PI);
});
it("stops a creature where it is drawn on the update that says it died, and holds it until it respawns",()=>{
  const frame=(x:number,dead:boolean,placement="fallowmarch|animal_coyote")=>({position:[x,0,0] as [number,number,number],facing:0,dead,placement});
  const motion=new ActorInterpolation([0,0,0],0);
  followReplicatedActor(motion,frame(0,false),frame(1,false),0,100);
  expect(motion.sample(50)).toEqual([.5,0,0]);
  // The kill tick carries the step the body had not finished drawing. It is not taken.
  followReplicatedActor(motion,frame(1,false),frame(1.3,true),50,100);
  expect(motion.sample(50)).toEqual([.5,0,0]);
  expect(motion.sample(400)).toEqual([.5,0,0]);
  // Later corpse updates do not pull it onto the authoritative spot either.
  followReplicatedActor(motion,frame(1.3,true),frame(1.3,true),500,100);
  expect(motion.sample(700)).toEqual([.5,0,0]);
  // A respawn is a teleport home, not a walk.
  followReplicatedActor(motion,frame(1.3,true),frame(-4,false),800,100);
  expect(motion.sample(800)).toEqual([-4,0,0]);
});
