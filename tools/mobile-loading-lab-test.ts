/** Prove release delivery in the production lab before full-world integration. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startGameServer } from './lib/server.js';
import { installTestDeadline } from './lib/deadline.js';

const desktop = process.argv.includes('--desktop');
const clear = installTestDeadline('Loading lab', 60_000);
const server = await startGameServer();
const browser = await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const output = path.resolve(`test-results/${desktop ? 'desktop' : 'mobile'}-loading-lab`);
const environment = process.argv.includes('--environment');
await mkdir(output,{recursive:true});
try {
  const page = await browser.newPage({viewport:desktop ? {width:1440,height:900} : {width:844,height:390},
    hasTouch:!desktop,isMobile:!desktop,deviceScaleFactor:desktop ? 1 : 2});
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  page.on('request',r=>requests.push(new URL(r.url()).pathname));
  await page.route('**/assets/**',async route=>{
    const relative = new URL(route.request().url()).pathname.slice(1);
    const file = path.resolve('game/dist',relative);
    if (!file.startsWith(path.resolve('game/dist')+path.sep)) throw new Error('Path escaped fixture');
    try {
      const body = await readFile(file);
      const contentType = file.endsWith('.json') ? 'application/json' : file.endsWith('.webp') ? 'image/webp'
        : file.endsWith('.png') ? 'image/png' : 'application/octet-stream';
      await route.fulfill({body,contentType});
    } catch { await route.continue(); }
  });
  await page.goto(`${server.url}/?mode=combat&spawnSpacing=1&performance=1&${environment ? 'environment=1&startup-cache=0' : 'startup-cache=1&world-data=/generated/world-lab/manifest.json'}`,{waitUntil:'commit'});
  await page.locator('.boot-progress').waitFor();
  await page.screenshot({path:path.join(output,'loading.png'),timeout:5000});
  await page.locator('#boot-screen').waitFor({state:'detached',timeout:40_000});
  const state = await page.evaluate(()=>({ready:(window as any).__gameDebug.getState().ready,
    cache:(window as any).__corealmGenerationCache?.snapshot(), errors:(window as any).__gameDebug.getErrors(),
    assets:(window as any).__corealmPlayerAssets.snapshot()}));
  assert.equal(state.ready,true);
  if (!environment) {
    assert.deepEqual(state.cache.generated,[]);
    assert.ok(state.cache.shipped.some((k:string)=>k.startsWith('terrain-draw/')));
  }
  assert.ok(requests.some(url=>url.endsWith('.model')));
  const textures = desktop ? '/assets/optimized/' : '/assets/compact/';
  assert.ok(requests.some(url=>url.includes(textures) && url.endsWith('.webp')));
  assert.deepEqual(errors,[]); assert.deepEqual(state.errors,[]);
  await page.keyboard.press('Escape');
  await page.locator('#viewport').click({position:{x:430,y:170}});
  await page.screenshot({path:path.join(output,'playable.png'),timeout:5000});
  const before = await page.evaluate(()=>(window as any).__gameDebug.getPlayerPosition());
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
  const after = await page.evaluate(()=>(window as any).__gameDebug.getPlayerPosition());
  assert.notDeepEqual(before,after);
  if (environment) {
    await page.locator('#environment-lab-mode').selectOption('cut-face');
    const load = page.getByRole('button',{name:'Load selection',exact:true});
    await load.click();
    await page.waitForFunction(() => (window as any).__environmentLab.getState().ready
      && (window as any).__environmentLab.getState().mode === 'cut-face');
    const first = await page.evaluate(() => (window as any).__environmentLab.getState());
    await load.click();
    await page.waitForFunction(() => (window as any).__environmentLab.getState().ready);
    assert.deepEqual(await page.evaluate(() => (window as any).__environmentLab.getState()),first);
    await page.evaluate(async () => {
      const d = (window as any).__gameDebug;
      await d.inspectPose({x:70,y:d.groundHeight(70,18),z:18,yaw:Math.PI,pitch:.5,distance:9});
    });
    await page.waitForTimeout(400);
    await page.screenshot({path:path.join(output,'cached-cut.png')});
    assert.deepEqual(errors,[]);
    assert.deepEqual(await page.evaluate(() => (window as any).__gameDebug.getErrors()),[]);
  }
  await writeFile(path.join(output,'report.json'),JSON.stringify({state,requests,before,after,errors},null,2));
  console.log(JSON.stringify({passed:true,desktop,shipped:state.cache?.shipped,compactRequests:requests.filter(r=>r.includes(textures)).length,before,after}));
} finally {await browser.close();await server.close();clear();}
