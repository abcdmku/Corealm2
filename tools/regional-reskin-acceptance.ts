import "./lib/repoContent.js";
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { installTestDeadline } from './lib/deadline.js';
import { gearAppearanceParts } from '../game/src/render/equipmentVisuals.js';
import { ALL_ITEMS } from '../game/src/content/items.js';

const arg = (name: string, fallback: string) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1]! : fallback;
const tier = Number(arg('--tier', '30')), kind = arg('--set', 'metal');
const family = ({30: ['dewglass','willow','mistweave'],40:['crownsilver','maple','crownhide'],60:['staramethyst','yew','faesilk']} as Record<number,string[]>)[tier];
assert(family && ['metal','cloth','held'].includes(kind));
const [metal,wood,cloth] = family;
const ids = kind === 'metal' ? ['helm','plate','greaves','boots','gauntlets'].map(s => `${metal}_${s}`)
  : kind === 'cloth' ? ['hood','robe','leggings','boots','wraps'].map(s => `${cloth}_${s}`) : [];
ids.push(`${kind === 'metal' ? metal : wood}_${kind === 'metal' ? 'sword' : 'wand'}`);
const out = `test-results/regional-reskins/t${tier}-${kind}`;
await mkdir(out,{recursive:true});
const deadline = installTestDeadline('Regional reskin acceptance',60000);
const driver = new GameDriver({url:arg('--url','http://127.0.0.1:4316'),close:async()=>{}},
  {viewport:{width:1200,height:1800},browserArgs:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11','--mute-audio']});
const report: any = {passed:false,tier,kind,ids,captures:[]};
try {
  await driver.launch(); const page=driver.page!;
  await driver.open(25000,'/index.html?mode=combat&startup-cache=0');
  await page.evaluate(async ids=>{
    const lab=window.__featureLab!;lab.setFreeCameraEnabled(false);lab.setWalkingEnabled(true);
    await lab.setLevel('melee',99);await lab.setLevel('magic',99);
    for(const slot of ['head','body','legs','feet','hands','mainHand','offHand'] as const) await lab.equipPlayer(slot,null);
    await (await import('/src/render/regionalEquipmentTextures.ts' as string)).preloadRegionalEquipmentTextures(ids);
  },ids);
  for(const id of ids) {
    const slot=ALL_ITEMS.find(item=>item.id===id)!.equip!.slot;
    await page.evaluate(async ({slot,id})=>window.__featureLab!.equipPlayer(slot,id),{slot,id});
  }
  const close=page.locator('#panel-feature-lab .panel__close');if(await close.isVisible())await close.click();
  await page.mouse.move(600,900);for(let i=0;i<25;i++)await page.mouse.wheel(0,-100);
  const read=()=>page.evaluate(()=>({motion:(window.__gameDebug as any).getPlayerMotion(),player:(window.__gameDebug as any).getPlayerPosition(),camera:(window.__gameDebug as any).getCamera()}));
  const capture=async(name:string)=>{
    await page.waitForFunction(()=>!Object.keys((window.__gameDebug as any).getPlayerMotion().attachmentLoading??{}).length);
    const state=await read();assert.equal(state.camera.freeMove,false);
    assert(state.camera.requestedDistance>=6&&state.camera.requestedDistance<=11);
    assert(Math.abs(state.camera.target.y-state.player.y-1.1)<.3);
    assert.deepEqual(state.motion.attachmentErrors??{},{});
    const file=await driver.screenshot(out,name);report.captures.push({name,state,file});return state;
  };
  const orbit=async(angle:number)=>{
    if(await page.locator('.ctx-menu').isVisible())await page.keyboard.press('Escape');
    for(let attempt=0;attempt<4;attempt++){
      const state=await read(),delta=Math.atan2(Math.sin(state.motion.drawnRotationY+angle-state.camera.yaw),Math.cos(state.motion.drawnRotationY+angle-state.camera.yaw));
      const dx=Math.max(-280,Math.min(280,-delta/.006)),dy=Math.max(-160,Math.min(160,(.4-state.camera.pitch)/.004));
      if(Math.abs(dx)<1&&Math.abs(dy)<1)break;
      await page.mouse.move(600,900);await page.mouse.down({button:'right'});
      await page.mouse.move(600+dx,900+dy,{steps:8});await page.mouse.up({button:'right'});
    }
    await page.mouse.move(20,600);await page.waitForTimeout(180);
    const state=await read(),delta=state.motion.drawnRotationY+angle-state.camera.yaw;
    assert(Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta)))<.03,'Normal camera bearing did not settle');
  };
  for(const [view,angle] of [['front',.4],['side',Math.PI/2],['back',Math.PI+.4]] as const){await orbit(angle);await capture(view);}
  const before=await read();await page.keyboard.down('w');await page.waitForTimeout(450);const moving=await capture('walking');await page.keyboard.up('w');
  assert(Math.hypot(moving.player.x-before.player.x,moving.player.z-before.player.z)>.2);
  assert(/walk|jog|run/i.test(`${moving.motion.pose} ${moving.motion.clip}`));
  report.expected=ids.map(id=>({id,parts:gearAppearanceParts(id)}));
  for(const row of report.expected)for(const part of row.parts){
    if(part.attach==='skin')assert(before.motion.layerAssets.includes(part.assetId),`${row.id} missing existing skin`);
    else assert(Object.values(before.motion.attachments).some(value=>String(value).includes(part.assetId)),`${row.id} missing existing attachment`);
  }
  if(kind==='cloth'){
    await page.evaluate(async()=>window.__featureLab!.equipPlayer('body',null));
    await orbit(.4);await capture('leggings-visible');
  }
  if(kind==='held')for(const suffix of ['shield','staff']){
    await page.evaluate(async()=>{await window.__featureLab!.equipPlayer('offHand',null);await window.__featureLab!.equipPlayer('mainHand',null);});
    await page.evaluate(async ({id,slot})=>window.__featureLab!.equipPlayer(slot,id),{id:`${wood}_${suffix}`,slot:suffix==='shield'?'offHand' as const:'mainHand' as const});
    for(const [view,angle] of [['front',.4],['side',Math.PI/2],['back',Math.PI+.4]] as const){await orbit(angle);await capture(`${suffix}-${view}`);}
  }
  assert.deepEqual(driver.pageErrors,[]);assert.deepEqual(driver.consoleErrors,[]);report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}finally{
  await driver.close();deadline();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,out}));
}
