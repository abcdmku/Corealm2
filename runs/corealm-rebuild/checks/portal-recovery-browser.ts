import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GameDriver} from '../../../tools/lib/driver.js';
import {installTestDeadline} from '../../../tools/lib/deadline.js';
const out='test-results/portal-recovery-browser';await mkdir(out,{recursive:true});
const deadline=installTestDeadline('Portal recovery browser',45000);
const driver=new GameDriver({url:'http://127.0.0.1:4175',close:async()=>{}},{headless:true,browserArgs:['--use-angle=d3d11','--mute-audio']});
const report:any={passed:false};
try{
 await driver.launch();await driver.open(22000,'/index.html?mode=combat&portal=1');
 report.recovery=await driver.page!.evaluate(`(async () => {
  const {PortalTransition}=await import('/src/ui/portalTransition.ts');
  const locks=[];let commits=0,keyCount=0;const keys=()=>keyCount++;
  window.addEventListener('keydown',keys);
  const service=new PortalTransition(locked=>locks.push(locked));
  let failed;
  try{await service.run({name:'Unavailable passage',prepare:async()=>{throw new Error('test load failure');},commit:()=>commits++,settled:async()=>{}});}catch(error){failed=error.message;}
  const failedState={failed,active:service.active,curtains:document.querySelectorAll('.portal-transition').length,commits,locks:[...locks]};
  let releaseOld;
  const old=service.run({name:'Delayed passage',prepare:()=>new Promise(resolve=>releaseOld=resolve),commit:()=>commits++,settled:async()=>{}});
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true,cancelable:true}));
  const blockedKeys=keyCount;
  service.cancel();await old;
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true,cancelable:true}));
  const releasedKeys=keyCount;
  const next=service.run({name:'Loaded passage',prepare:async()=>{},commit:()=>commits++,settled:async()=>{}});
  releaseOld();await next;
  window.removeEventListener('keydown',keys);
  return {failedState,blockedKeys,releasedKeys,commits,locks,active:service.active,curtains:document.querySelectorAll('.portal-transition').length};
 })()`);
 assert.deepEqual(report.recovery.failedState,{failed:'test load failure',active:false,curtains:0,commits:0,locks:[true,false]});
 assert.equal(report.recovery.blockedKeys,0);assert.equal(report.recovery.releasedKeys,1);
 assert.equal(report.recovery.commits,1);assert.equal(report.recovery.active,false);assert.equal(report.recovery.curtains,0);
 report.errors=await driver.callDebug('getErrors');report.console=driver.consoleErrors;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{await driver.close();deadline();await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error}));}
