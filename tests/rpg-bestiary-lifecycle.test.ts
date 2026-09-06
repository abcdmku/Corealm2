import {expect,it} from 'vitest';
import {lifecycleMetrics} from '../tools/rpg-bestiary/lifecycle-metrics.js';
const sample=(at:number,x:number,heading:number,stage='pursuit',health=10)=>({at,stage,lab:{target:{entityId:'enemy',position:[x,0,0],health,state:health?'aggro':'dead',motion:{motion:health?'run':'death'}}},motion:{motion:health?'run':'death',clip:'Walk',time:at/1000,semanticRotationY:heading}});
it('excludes setup, death and respawn displacement while separating stationary aim',()=>{
 const trace=[sample(0,-100,0,'setup'),sample(100,0,0),sample(200,1,.4),sample(300,1,.7),sample(400,50,2,'kill',0),sample(500,100,3,'respawn-rendered'),sample(600,101,3.2,'capture-respawn-before'),sample(700,102,3.4,'capture-respawn-after')];
 const result=lifecycleMetrics(trace);
 expect(result.movedMetres).toBe(1);expect(result.movingTurnRadians).toBeCloseTo(.4);expect(result.inPlaceTurnRadians).toBeCloseTo(.3);expect(result.advancing).toEqual(['run']);
});
it('does not bridge dead samples or long sampling gaps',()=>{
 const result=lifecycleMetrics([sample(0,0,0),sample(100,5,1,'kill',0),sample(200,10,2),sample(1000,20,3)]);
 expect(result.movedMetres).toBe(0);expect(result.turnRadians).toBe(0);
});
