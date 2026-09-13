import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const hash=b=>createHash('sha256').update(b).digest('hex');
const out='test-results/aurora/viewer';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11']});
const page=await browser.newPage({viewport:{width:1600,height:1400}}),errors=[],shots=[],assets=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/models/frostweave/*.glb',async route=>{const response=await route.fetch(),body=await response.body();assets.push({url:route.request().url(),sha256:hash(body)});await route.fulfill({response,body});});
await page.route('**/viewer.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text())+'\nwindow.__auroraRead=()=>({camera:camera.position.toArray(),target:controls.target.toArray(),exposure:renderer.toneMappingExposure,environmentIntensity:scene.environmentIntensity});'});});
const shot=async(name)=>{const file=`${out}/${name}.png`,bytes=await page.screenshot({path:file});shots.push({name,file,sha256:hash(bytes),state:await page.evaluate(()=>window.__auroraRead())});};
const drag=async(dx,dy,button='left')=>{await page.mouse.move(800,650);await page.mouse.down({button});await page.mouse.move(800+dx,650+dy,{steps:20});await page.mouse.up({button});await page.waitForTimeout(650);};
const open=async piece=>{await page.goto(`http://127.0.0.1:4186/?set=frostweave&piece=${piece}`);await page.waitForFunction(()=>window.armorViewer.ready);await page.waitForTimeout(700);};
try {
  await open('all');await shot('full-front');await drag(700,0);await shot('full-back');
  await open('robe');await shot('robe-front');await drag(0,270,'right');await page.mouse.move(800,650);
  for(let i=0;i<9;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(70);}await page.waitForTimeout(650);await shot('chest-detail');
  await drag(240,0);await shot('shoulder-side');
  await drag(180,0);await shot('shoulder-profile');
  await drag(270,0);await shot('shoulder-back');
  await open('robe');await page.mouse.move(800,650);
  for(let i=0;i<3;i++){await page.mouse.wheel(0,-110);await page.waitForTimeout(70);}await page.waitForTimeout(600);await shot('robe-points');
  await open('robe');await drag(700,0);await page.mouse.move(800,650);
  for(let i=0;i<4;i++){await page.mouse.wheel(0,-110);await page.waitForTimeout(70);}await page.waitForTimeout(600);await shot('rear-scales');
  await open('hood');await shot('hood-crown');
  assert.deepEqual(errors,[]);
  for(const a of assets){const part=new URL(a.url).pathname.match(/\/([^/]+)\.glb$/)[1];assert.equal(a.sha256,hash(await readFile(`art/item-models/candidates/armor-frostweave-aurora/models/items/frostweave_${part}.glb`)));}
  const reference=await page.evaluate(()=>({src:document.getElementById('reference').getAttribute('src'),width:document.getElementById('reference').naturalWidth}));
  assert.equal(reference.src,'/aurora-reference.png');assert(reference.width>0);
  await mkdir('runs/aurora',{recursive:true});await writeFile('runs/aurora/viewer.json',JSON.stringify({passed:true,assets,shots,errors,reference,normalViewerControls:true},null,2)+'\n');
  console.log(JSON.stringify({passed:true,shots:shots.map(s=>s.file)}));
} finally {await browser.close();}
