/** Production sampled animation, terrain contact and real mobile movement within the lab budget. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startGameServer } from './lib/server.js';
import { installTestDeadline } from './lib/deadline.js';

const rigs = process.argv.includes('--rigs');
const auto = process.argv.includes('--auto');
const clear = installTestDeadline('Mobile runtime lab', 60_000), out = `test-results/mobile-runtime-lab${rigs?'-rigs':auto?'-auto':''}`;
await mkdir(out, { recursive: true });
const existingUrl = process.argv.find(value => value.startsWith('--url='))?.slice('--url='.length);
const server = existingUrl ? { url: existingUrl, close: async () => {} } : await startGameServer();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio'] });
try {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/assets/**', async route => {
    const file = path.resolve('game/dist', new URL(route.request().url()).pathname.slice(1));
    if (!file.startsWith(path.resolve('game/dist') + path.sep)) throw Error('Asset path outside release');
    try { await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.json') ? 'application/json' : 'application/octet-stream' }); }
    catch { await route.continue(); }
  });
  await page.addInitScript({ content: `window.__name=v=>v;window.__frames=[];window.__phase='boot';
    let previous=performance.now();requestAnimationFrame(function step(at){window.__frames.push({ms:at-previous,phase:window.__phase});previous=at;requestAnimationFrame(step)});` });
  await page.goto(`${server.url}/?mode=combat&performance=1&motion=legacy&motionActors=animal_cattle,animal_deer,animal_boar&${rigs?'rigBudget=tiny':'sampledActors=1'}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => (window as any).__gameDebug?.getState().ready, undefined, { timeout: 35000 });
  await page.locator('#boot-screen').waitFor({ state: 'detached' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: auto ? 1 : 4 });
  if(rigs) await page.evaluate(async()=>{
    await (window as any).__featureLab.spawnTarget('creature','species:goblin_archer',{distance:4});
  });
  await page.evaluate(async () => {
    const w = window as any; w.__featureLab.setWalkingEnabled(true); w.__featureLab.setFreeCameraEnabled(false);
    // Normal follow camera and legal interactive distance, looking across the patrol fixture.
    const d = w.__gameDebug;
    await d.teleport([-58,d.groundHeight(-58,26),26]);
    const p = d.getPlayerPosition();
    await d.inspectPose({ x:p.x,y:p.y,z:p.z,yaw:Math.PI,pitch:.45,distance:11 });
  });
  await page.getByRole('button',{name:'Close Feature lab',exact:true}).click();
  await page.waitForFunction(()=>(window as any).__renderDistanceLab.shaders().waiting===0,undefined,{timeout:10000});
  if(auto) await page.evaluate(()=>(window as any).__renderDistanceLab.set({drawDistance:'near',autoDrawDistance:true}));
  const capture = () => page.evaluate(async () => {
    const w = window as any, d = w.__gameDebug;
    const player = d.getPlayerPosition();
    const selected = w.__corealmPlayerAssets.selectArea({position:[player.x,player.y,player.z],regionId:'fallowmarch',resourceRadius:6,viewRadius:6});
    const canvas = document.querySelector('canvas')!;
    return { player, selected, buffer: { width: canvas.width, height: canvas.height }, actors: await Promise.all(w.__groundMotionLab.actors.map(async (a:any)=>({
      id:a.entityId, entity:await d.getEntity(a.entityId), motion:d.getEntityMotion(a.entityId), bounds:d.getDrawnBounds(a.entityId),
    }))), errors:d.getErrors(), views:d.getEntityViewStats(), distance:w.__renderDistanceLab.getState() };
  });
  const before = await capture();
  await page.evaluate(() => { (window as any).__phase='idle'; });
  await page.waitForTimeout(auto ? 23000 : 5000);
  const idle = await capture();
  if(auto){
    assert.equal(idle.distance.settings.drawDistance,'near','Idle frames must not trigger an automatic loading expansion');
    await page.evaluate(()=>(window as any).__renderDistanceLab.set({drawDistance:'medium',autoDrawDistance:false}));
  }
  await page.screenshot({ path: path.join(out,'idle.png'), timeout:5000 });
  await page.evaluate(() => { (window as any).__phase='moving'; });
  const stick = await page.getByRole('slider',{name:'Move',exact:true}).boundingBox(); assert.ok(stick);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:stick.x+stick.width/2+30,y:stick.y+stick.height/2,id:1}]});
  await page.waitForTimeout(2000);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const after = await capture();
  assert.deepEqual(after.buffer, before.buffer, 'Mobile distance tuning must preserve drawing-buffer resolution');
  assert.equal(after.distance.settings.renderScale, before.distance.settings.renderScale);
  assert.ok(before.selected.includes('ground-motion:animal_cattle'),'Nearby actor enters the travel working set');
  assert.ok(!after.selected.includes('ground-motion:animal_cattle'),'Real movement refreshes the cached travel working set');
  await page.screenshot({ path: path.join(out,'moving.png'), timeout:5000 });
  const frames = await page.evaluate(() => (window as any).__frames);
  await writeFile(path.join(out,'report.json'),JSON.stringify({ before,idle,after,frames,errors },null,2));
  assert.ok(Math.hypot(after.player.x-before.player.x,after.player.z-before.player.z)>1,'Real joystick movement');
  for (const actor of after.actors) {
    if(!rigs) assert.equal(actor.motion.path,'sampled-rig');
    assert.ok(actor.motion.time !== before.actors.find((a:any)=>a.id===actor.id).motion.time,'Animation advances');
    assert.ok(actor.bounds);
    assert.ok(actor.motion.terrainContact?.maxClearanceError < .005,'Ground contact');
  }
  if(rigs){
    assert.ok(before.views.uniqueViews>0,'Fixture must hold a full rig');
    assert.ok(idle.views.rigBuilds-before.views.rigBuilds<=2,'Idle neighbours must not rebuild every frame');
  }
  if(auto){
    assert.equal(after.distance.settings.drawDistance,'medium');
    assert.ok(after.views.residency.actorRadius<=90,'Mobile distance increases must be gradual');
  }
  assert.deepEqual(errors,[]); assert.deepEqual(after.errors,[]);
  console.log(JSON.stringify({ passed:true,actors:after.actors.map((a:any)=>({id:a.id,path:a.motion.path,contact:a.motion.terrainContact.maxClearanceError})),before:before.player,after:after.player }));
} finally { await browser.close(); await server.close(); clear(); }
