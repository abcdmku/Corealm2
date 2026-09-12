import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { GameDriver } from './lib/driver.js';
import { argValue, repoRoot } from './lib/paths.js';
import { installAssetCandidates } from './lib/assetCandidates.js';

const args = process.argv.slice(2);
const part = argValue(args, '--part') ?? 'portal';
const out = path.join(repoRoot, 'test-results/fairy-expansion', part);
await mkdir(out, { recursive: true });
const driver = new GameDriver({ url: argValue(args, '--url') ?? 'http://127.0.0.1:4179', close: async () => {} }, {
  viewport: { width: 1440, height: 900 },
  browserArgs: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const evidence: Record<string, unknown> = {};
try {
  await driver.launch();
  const catalog = argValue(args, '--catalog');
  if (catalog) await installAssetCandidates(driver.page!, catalog);
  const page = driver.page!;
  const world = part === 'world' || part === 'release';
  await driver.open(60_000, world ? '/index.html?startup-cache=0' :
    `/index.html?mode=${part === 'castle' ? 'building' : 'combat'}&environment=1&atmosphere=1&fairy=1&startup-cache=0`);
  const snap = () => page.evaluate(() => {
    const d = window.__gameDebug as any;
    return { player: d.getPlayer(), camera: d.getCamera(), errors: d.getErrors(),
      lab: window.__featureLab?.getState(), sky: (window as any).__biomeAtmosphereLab?.getState() };
  });
  const pose = async (x: number, z: number, yaw = 0, distance = 18) => page.evaluate(({ x, z, yaw, distance }) => {
    const d = window.__gameDebug as any;
    const sample = d.sampleWorld?.(x, z) ?? d.getWorldSample?.(x, z);
    d.inspectPose({ x, y: sample?.height ?? (x > 1900 ? -120 : 0), z, yaw, pitch: .35, distance, detached: false });
  }, { x, z, yaw, distance: Math.min(distance, 11) });
  const clickEntity = async (id: string) => {
    await page.waitForFunction(id => !!(window.__gameDebug as any).getDrawnBounds(id), id, { timeout: 15_000 });
    const points = await page.evaluate(id => {
      const d = window.__gameDebug as any, b = d.getDrawnBounds(id), c = d.getCamera();
      const eye = c.position, target = c.target;
      const v = [target.x-eye.x,target.y-eye.y,target.z-eye.z], len = Math.hypot(...v), f=v.map(n=>n/len);
      const rl=Math.hypot(f[2]!,f[0]!), r=[-f[2]!/rl,0,f[0]!/rl];
      const u=[r[1]!*f[2]!-r[2]!*f[1]!,r[2]!*f[0]!-r[0]!*f[2]!,r[0]!*f[1]!-r[1]!*f[0]!];
      const canvas=document.querySelector('#viewport')!.getBoundingClientRect(), tangent=Math.tan(55*Math.PI/360);
      const out=[];
      for(const yy of [.45,.2,.7,.9]) for(const xx of [.18,.82,.5,.05,.95]) {
        const p=[b.min.x+(b.max.x-b.min.x)*xx-eye.x,b.min.y+(b.max.y-b.min.y)*yy-eye.y,(b.min.z+b.max.z)/2-eye.z];
        const depth=p.reduce((sum,n,i)=>sum+n*f[i]!,0), dx=p.reduce((sum,n,i)=>sum+n*r[i]!,0), dy=p.reduce((sum,n,i)=>sum+n*u[i]!,0);
        out.push({x:canvas.left+canvas.width/2+dx/depth/tangent*canvas.height/2,y:canvas.top+canvas.height/2-dy/depth/tangent*canvas.height/2});
      }
      return out;
    }, id);
    for(const p of points) {
      if(p.x<10||p.x>1430||p.y<10||p.y>820) continue;
      await page.mouse.move(p.x,p.y); await page.waitForTimeout(60);
      if(await page.evaluate(id=>(window.__gameDebug as any).getState().hoveredEntityId===id,id)) {
        await page.mouse.click(p.x,p.y); return;
      }
    }
    throw new Error(`No visible pointer target for ${id}`);
  };
  if (part === 'castle') {
    await page.evaluate(async () => { await window.__featureLab!.setStructure({ kind: 'composition', id: 'white_knight_castle', kit: 'stone' }); });
    await page.getByLabel('Biome atmosphere').selectOption('crownward');
    await pose(0, 40, 0, 25);
    await page.screenshot({ path: path.join(out, 'white-castle.png') });
    evidence.castle = await snap();
  } else if (part === 'creatures') {
    const ids = (argValue(args, '--presets') ?? 'pearl_knight,lantern_sprite,amethyst_sovereign').split(',');
    for (const id of ids) {
      const biome = id === 'pearl_knight' || id === 'ivory_castellan' ? 'crownward' : id === 'amethyst_sovereign' ? 'faeholme' : 'gloamgarden';
      await page.getByLabel('Biome atmosphere').selectOption(biome);
      await pose(0, 12, 0, 16);
      await page.evaluate(async id => { await window.__featureLab!.spawnTarget('creature', `species:${id}`, { distance: 5 }); }, id);
      await page.waitForTimeout(600);
      const before = await page.evaluate(() => { const id = window.__featureLab!.getState().target!.entityId; return (window.__gameDebug as any).getEntity(id); });
      await page.screenshot({ path: path.join(out, `${id}.png`) });
      await page.evaluate(async () => { window.__featureLab!.setLevel('melee', 99); await window.__featureLab!.perform('attack'); });
      await page.waitForFunction(id => { const e = (window.__gameDebug as any).getEntity(id); return e && (e.combat.health < e.combat.maxHealth || e.state !== 'alive'); }, before.id, { timeout: 10_000 });
      evidence[id] = { before, after: await page.evaluate(id => (window.__gameDebug as any).getEntity(id), before.id), state: await snap() };
    }
  } else if (part === 'resources') {
    const sites = (argValue(args, '--sites') ?? 'dewglass_workings,crown_silver_quarry,star_amethyst_cut,moonpetal_grove,orchid_yew_grove').split(',');
    await page.evaluate(() => {
      window.__featureLab!.setLevel('mining', 99); window.__featureLab!.setLevel('woodcutting', 99);
      (window.__gameDebug as any).giveItem('emberite_pickaxe', 1, 'inventory');
      (window.__gameDebug as any).giveItem('emberite_hatchet', 1, 'inventory');
    });
    for (const site of sites) {
      await page.evaluate(async site => { await (window as any).__environmentLab.showSite(site); }, site);
      const fixture = await page.evaluate(() => (window as any).__environmentLab.getState());
      await pose(0, 28, .35, 23);
      await page.screenshot({ path: path.join(out, `${site}.png`) });
      const node = await page.evaluate(ids => ids.map((id:string)=>(window.__gameDebug as any).getEntity(id))
        .filter((entity:any)=>entity?.resource?.remaining>0)
        .sort((a:any,b:any)=>Math.hypot(b.position[0]+8,b.position[2]-12)-Math.hypot(a.position[0]+8,a.position[2]-12))[0], fixture.entityIds);
      assert(node, `No gatherable fixture for ${site}`);
      const anchor = node.interactionPosition ?? node.position;
      const cursor = await page.evaluate(()=>(window.__gameDebug as any).getEvents(0).nextSeq);
      let clicked = false;
      for (const yaw of [.25, Math.PI, -Math.PI / 2, Math.PI / 2]) {
        await pose(anchor[0] + Math.sin(yaw) * 1.9, anchor[2] + Math.cos(yaw) * 1.9, yaw, 11);
        await page.waitForTimeout(300);
        try { await clickEntity(node.id); clicked = true; break; } catch { /* Try another normal approach around nearby scenery. */ }
      }
      assert(clicked, `No unobstructed approach to ${node.id}`);
      await page.waitForFunction(({id,cursor})=>(window.__gameDebug as any).getEvents(cursor).events.some((event:any)=>
        event.type==='item.received'&&event.entityId===id&&event.data.source==='gather'), {id:node.id,cursor}, {timeout:15_000});
      const after = await page.evaluate(id=>(window.__gameDebug as any).getEntity(id),node.id);
      assert(after.resource.remaining < node.resource.remaining);
      evidence[site] = {fixture,before:node,after,events:await page.evaluate(cursor=>(window.__gameDebug as any).getEvents(cursor),cursor)};
      await page.screenshot({path:path.join(out,`${site}-gather.png`)});
      await page.evaluate(()=>(window.__gameDebug as any).callTool('corealm_stop',{}));
    }
  } else if (part === 'foliage') {
    for (const [id, biome] of [['corealm_willow_gloam_1', 'gloamgarden'], ['corealm_yew_fae_1', 'faeholme']]) {
      await page.getByLabel('Biome atmosphere').selectOption(biome!);
      await page.evaluate(async id => { await (window as any).__environmentLab.showFoliage(id, { count: 6, span: 28, layout: 'grid' }); }, id!);
      await pose(0, 34, .3, 25);
      await page.screenshot({ path: path.join(out, `${id}.png`) });
      evidence[id!] = { fixture: await page.evaluate(() => (window as any).__environmentLab.getState()), state: await snap() };
    }
  } else if (part === 'release') {
    await page.getByRole('button', {name:'Open full map',exact:true}).click();
    await page.getByRole('button', {name:'Reset map view',exact:true}).click();
    await page.waitForTimeout(1800);
    evidence.surfaceMap = await page.locator('.map__figure').getAttribute('data-map-world-bounds');
    assert(JSON.parse(evidence.surfaceMap as string).maxX >= 700);
    await page.screenshot({path:path.join(out,'surface-map.png')});
    await page.locator('#panel-map .panel__close').click();
    await pose(470,108,0,18);
    evidence.beforePortal=await snap();
    await clickEntity('crownward_fairy_gate');
    await page.waitForFunction(()=>(window.__gameDebug as any).getPlayer().regionId==='gloamgarden',undefined,{timeout:25_000});
    await page.locator('.portal-transition').waitFor({state:'detached',timeout:45_000});
    evidence.arrived=await snap();
    assert((evidence.arrived as any).player.position.y < -100);
    await page.screenshot({path:path.join(out,'gloamgarden.png')});
    await page.getByRole('button',{name:'Open full map',exact:true}).click();
    await page.getByRole('button',{name:'Reset map view',exact:true}).click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.map__figure').getAttribute('data-map-id'),'fairy');
    await page.screenshot({path:path.join(out,'fairy-map.png')});
  } else if (part === 'world') {
    evidence.roster = await page.evaluate(() => (window.__gameDebug as any).getEntities().filter((e:any)=>['crownward','gloamgarden','faeholme'].includes(e.regionId)));
    assert((evidence.roster as any[]).length > 100);
    await page.getByRole('button', {name:'Open full map',exact:true}).click();
    await page.getByRole('button', {name:'Reset map view',exact:true}).click();
    await page.waitForTimeout(500);
    evidence.surfaceMap = await page.locator('.map__figure').getAttribute('data-map-world-bounds');
    assert(JSON.parse(evidence.surfaceMap as string).maxX >= 700);
    await page.screenshot({path:path.join(out,'surface-map.png')});
    await page.locator('#panel-map .panel__close').click();
    await pose(550, -112, Math.PI, 25);
    await page.waitForTimeout(1800);
    await page.screenshot({ path:path.join(out,'crownward-castle.png') });
    await pose(470,108,0,18);
    evidence.beforePortal=await snap();
    await clickEntity('crownward_fairy_gate');
    await page.waitForFunction(()=>(window.__gameDebug as any).getPlayer().regionId==='gloamgarden',undefined,{timeout:25_000});
    await page.locator('.portal-transition').waitFor({ state: 'detached', timeout: 45_000 });
    await page.waitForTimeout(600);
    evidence.fairyArrival=await snap();
    await page.screenshot({ path:path.join(out,'gloamgarden-arrival.png') });
    await page.getByRole('button', {name:'Open full map',exact:true}).click();
    await page.locator('[data-map-id="fairy"] canvas').last().waitFor({state:'visible'});
    await page.waitForTimeout(300);
    await page.screenshot({ path:path.join(out,'fairy-map.png') });
    await page.locator('#panel-map .panel__close').click();
    await page.evaluate(() => {
      const d = window.__gameDebug as any;
      d.setSkillLevel('mining',99); d.giveItem('emberite_pickaxe',1,'inventory');
    });
    const mineId = (evidence.roster as any[]).find(e=>e.regionId==='gloamgarden'&&e.interactions.includes('mine'))?.id;
    const mine = await page.evaluate(id=>(window.__gameDebug as any).getEntity(id),mineId);
    assert(mine);
    const anchor = mine.interactionPosition ?? mine.position;
    await pose(anchor[0]+2,anchor[2]+3,.25,13);
    await page.waitForTimeout(1200);
    const cursor=await page.evaluate(()=>(window.__gameDebug as any).getEvents(0).nextSeq);
    await clickEntity(mine.id);
    await page.waitForFunction(({id,cursor})=>(window.__gameDebug as any).getEvents(cursor).events.some((event:any)=>
      event.type==='item.received'&&event.entityId===id&&event.data.source==='gather'),{id:mine.id,cursor},{timeout:15_000});
    evidence.worldMining=await page.evaluate(cursor=>(window.__gameDebug as any).getEvents(cursor),cursor);
    await page.screenshot({path:path.join(out,'world-mining.png')});
    await page.evaluate(()=>(window.__gameDebug as any).callTool('corealm_stop',{}));
    await pose(2300,126,Math.PI,18);
    await page.locator('canvas#viewport').focus();
    await page.keyboard.down('w'); await page.waitForTimeout(2500); await page.keyboard.up('w');
    evidence.crossed=await snap();
    assert.equal((evidence.crossed as any).player.regionId,'faeholme');
    await pose(2390,235,0,22);
    await page.waitForTimeout(1800);
    await page.screenshot({ path:path.join(out,'faeholme-garden.png') });
    const saved=await page.evaluate(()=>(window.__gameDebug as any).getSaveBlob());
    await pose(2068,-120,0,18);
    await clickEntity('gloamgarden_crownward_gate');
    await page.waitForFunction(()=>(window.__gameDebug as any).getPlayer().regionId==='crownward',undefined,{timeout:25_000});
    await page.locator('.portal-transition').waitFor({ state: 'detached', timeout: 45_000 });
    evidence.returned=await snap();
    await page.evaluate(saved=>(window.__gameDebug as any).loadSaveBlob(saved),saved);
    evidence.restored=await snap();
    assert.equal((evidence.restored as any).player.regionId,'faeholme');
  } else if (part === 'portal') {
    await pose(18, 17);
    evidence.before = await snap();
    await page.getByRole('button', { name: 'Enter fairy portal', exact: true }).click();
    await page.waitForFunction(() => (window.__gameDebug as any).getPlayer().regionId === 'gloamgarden', undefined, { timeout: 20_000 });
    await page.locator('.portal-transition').waitFor({ state: 'detached', timeout: 45_000 });
    evidence.entered = await snap();
    await page.getByLabel('Biome atmosphere').selectOption('gloamgarden');
    await page.locator('canvas#viewport').click({ position: { x: 700, y: 500 } });
    await page.keyboard.down('w'); await page.waitForTimeout(600); await page.keyboard.up('w');
    evidence.moved = await snap();
    await page.screenshot({ path: path.join(out, 'fairy-arrival.png') });
    await pose(2032, -2);
    await page.getByRole('button', { name: 'Return through portal', exact: true }).click();
    await page.waitForFunction(() => (window.__gameDebug as any).getPlayer().regionId === 'fallowmarch', undefined, { timeout: 20_000 });
    await page.locator('.portal-transition').waitFor({ state: 'detached', timeout: 45_000 });
    evidence.returned = await snap();
    assert.notDeepEqual((evidence.entered as any).player.position, (evidence.moved as any).player.position);
  }
  evidence.final = await snap();
  assert.deepEqual((evidence.final as any).errors, []);
  assert.deepEqual(driver.pageErrors, []);
  evidence.passed = true;
} catch (cause) {
  evidence.error = String(cause);
  if (driver.page) { evidence.body = await driver.page.locator('body').innerText().catch(() => 'unavailable'); await driver.page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); }
  process.exitCode = 1;
} finally {
  evidence.consoleErrors = driver.consoleErrors;
  evidence.pageErrors = driver.pageErrors;
  await writeFile(path.join(out, 'report.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ part, passed: evidence.passed ?? false, error: evidence.error, out }));
  await driver.close();
}
