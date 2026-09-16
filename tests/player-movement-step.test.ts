import { expect, it } from 'vitest';
import { SimClock } from '../game/src/core/time.js';
import { stepPlayerFrame } from '../game/src/app/playerMovementStep.js';
import { Movement } from '../game/src/systems/movement.js';
import type { Navigation } from '../game/src/systems/navigation.js';
import type { Vec3 } from '../game/src/contracts.js';
import { EventBus } from '../game/src/core/events.js';
import { createInitialState } from '../game/src/state/store.js';

it('moves on the first frame and conserves elapsed movement around fixed world ticks', () => {
  const clock = new SimClock(), steps: number[] = [], worldPositions: number[] = [];
  let position = 0;
  const frame = (ms: number) => stepPlayerFrame(clock, ms, delta => {
    steps.push(delta); position += delta;
  }, () => { worldPositions.push(position); clock.commitTick(); });
  frame(16); expect(position).toBe(16); expect(clock.tick).toBe(0);
  frame(16); frame(83); frame(135);
  expect(position).toBeCloseTo(250);
  expect(worldPositions).toEqual([100, 200]);
  expect(Math.max(...steps)).toBeLessThanOrEqual(20);
  clock.paused = true; frame(1000); expect(position).toBe(250);
  clock.paused = false; clock.timeScale = 2; frame(25);
  expect(position).toBeCloseTo(300); expect(clock.tick).toBe(3);
});

it('conserves movement across frame rates without advancing the combat clock faster', () => {
  for (const fps of [30, 60, 120]) {
    const clock = new SimClock(); let movedMs = 0;
    for (let i = 0; i < fps; i++) stepPlayerFrame(clock, 1000 / fps,
      delta => { movedMs += delta; }, () => clock.commitTick());
    expect(movedMs).toBeCloseTo(1000);
    expect(clock.elapsedMs + clock.alpha() * 100).toBeCloseTo(1000);
  }
});

it('starts actual movement within one frame and keeps speed and wall collision stable across frame rates', () => {
  const distances: number[] = [];
  for (const fps of [30,60,120]) {
    const state=createInitialState();state.player.position=[0,0,0];
    const clock=new SimClock();
    const movement=new Movement({closestPoint:(point:Vec3)=>point} as Navigation,new EventBus(),
      {solids:{resolve:point=>[Math.min(5,point[0]),point[1],point[2]]}});
    movement.setDirectInput({forward:0,strafe:1,cameraYaw:0});
    const frame=()=>stepPlayerFrame(clock,1000/fps,(delta,at)=>movement.update(state,delta,at),()=>clock.commitTick());
    frame(); expect(state.player.position[0]).toBeGreaterThan(0);
    for(let i=1;i<fps;i++)frame();
    distances.push(state.player.position[0]);
    for(let i=0;i<fps;i++)frame();
    expect(state.player.position[0]).toBeCloseTo(5);
    expect(movement.getSpeedMps()).toBeLessThan(.001);
  }
  expect(Math.max(...distances)-Math.min(...distances)).toBeLessThan(.08);
});
