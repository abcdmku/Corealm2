import {expect,it} from "vitest";
import {ActorInterpolation} from "../game/src/multiplayer/interpolation.js";

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
