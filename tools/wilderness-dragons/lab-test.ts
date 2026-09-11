import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {GameDriver} from '../lib/driver.js';
import {startGameServer} from '../lib/server.js';
import {installAssetCandidates} from '../lib/assetCandidates.js';
import {installTestDeadline} from '../lib/deadline.js';

const deep=process.argv.includes('--deep'),emittingOnly=process.argv.includes('--emitting-only'),redOnly=process.argv.includes('--red-only'),blackOnly=process.argv.includes('--black-only');
const materialOnly=process.argv.includes('--material-only');
assert(Number(emittingOnly)+Number(redOnly)+Number(blackOnly)<=1,'Select one family per focused job.');
const band=deep?['red_wilderness_dragon','black_wilderness_dragon','purple_wilderness_dragon']:['baby_red_dragon','baby_black_dragon','baby_lava_dragon'];
const ids=emittingOnly?[band[2]!]:redOnly?[band[0]!]:blackOnly?[band[1]!]:band;
const suffix=emittingOnly?'-fissures':redOnly?'-red':blackOnly?'-black':'';
const out=`test-results/wilderness-dragons/lab-${deep?'deep':'shallow'}${suffix}-${materialOnly?'materials':'full'}`;await mkdir(out,{recursive:true});
const clearDeadline=installTestDeadline(`Wilderness dragons ${deep?'deep':'shallow'}${suffix} full motion`,60_000);
const started=Date.now(),server=await startGameServer({hmr:false}),driver=new GameDriver(server,{viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const evidence:any[]=[];let passed=false;
try{
 await driver.launch();const page=driver.page!;await installAssetCandidates(page,'test-results/wilderness-dragons/catalog.json');
 await driver.open(45000,'/index.html?mode=combat&creatures=1&atmosphere=1&wildernessCreatures=1');
 await page.getByRole('button',{name:'Close Feature lab',exact:true}).click();
 await page.getByLabel('Biome atmosphere',{exact:true}).selectOption(deep?'deep_wilderness':'wilderness');
 await page.waitForFunction(deep=>{
  const a=(window as any).__biomeAtmosphereLab?.getState();
  return a?.sky.enabled&&a.sky.night>.98&&(deep?a.sky.magic>.98:a.sky.magic<.02);
 },deep,{timeout:12000});
 evidence.push({atmosphere:await page.evaluate(()=>(window as any).__biomeAtmosphereLab.getState())});
 await page.evaluate(()=>{
  (window as any).__dragonReadSample=()=>{
   const g=(window as any).__creatureGallery,s=g.getState(),d=window.__gameDebug as any;
   return{atMs:performance.now(),gallery:s,motion:d.getEntityMotion(s.entityIds[0]),drawn:d.getDrawnBounds(s.entityIds[0]),ground:d.groundHeight(0,70),camera:d.getCamera(),atmosphere:(window as any).__biomeAtmosphereLab.getState(),particles:(window as any).__wildernessCreatureEffects.getState()};
  };
 });
 const readSample=()=>page.evaluate(()=>(window as any).__dragonReadSample());
 const checkSample=(id:string,motion:string,sample:any)=>{
  assert(sample.gallery.ready&&sample.motion&&sample.drawn,`${id}/${motion}: missing production rig`);
  assert(sample.drawn.height>.4&&sample.drawn.height<8,`${id}/${motion}: invalid rig bounds`);
  assert(sample.atmosphere.sky.night>.98&&(deep?sample.atmosphere.sky.magic>.98:sample.atmosphere.sky.magic<.02),`${id}/${motion}: atmosphere not settled`);
  assert(!sample.camera.freeMove&&sample.camera.distance>=6&&sample.camera.distance<=11,`${id}/${motion}: camera outside gameplay controls`);
 };
 const settleIdle=async()=>{
  await page.locator('#creature-gallery-idle').click();
  await page.waitForFunction(()=>{
   const g=(window as any).__creatureGallery.getState(),m=(window.__gameDebug as any).getEntityMotion(g.entityIds[0]);
   return m?.motion==='idle'&&m.clip==='Idle'&&!m.hitOverlay;
  },null,{timeout:8000});
 };
 for(const id of ids){
  await page.evaluate(async({id,deep})=>{
   await (window as any).__creatureGallery.show(`candidate:${id}`,1);
   // Ordinary player-follow camera; 1.7 m sideways placement leaves the head visible.
   (window.__gameDebug as any).inspectPose({x:1.7,y:0,z:deep?74:72,yaw:-.38,pitch:.38,distance:deep?11:8});
  },{id,deep});
  await page.waitForTimeout(180);
  await page.waitForFunction(()=>{
   const s=(window as any).__creatureGallery.getState(),d=window.__gameDebug as any,b=d.getDrawnBounds(s.entityIds[0]),q=(window as any).__renderDistanceLab?.shaders?.();
   return s.ready&&b&&b.height>.4&&(!q||q.waiting===0&&q.queued===0&&q.compiling===0);
  },null,{timeout:12000});
  await page.waitForFunction(deep=>{
   const g=(window as any).__creatureGallery.getState(),fx=(window as any).__wildernessCreatureEffects?.getState();
   return fx?.ready&&fx.enabled&&fx.emitters.some((e:any)=>g.entityIds.includes(e.id)&&e.particles>0&&e.palette===(deep?'arcane':'ember'));
  },deep,{timeout:5000});
  for(const motion of materialOnly?['idle','walk']:['idle','walk','run','attack','hit']){
   if(motion==='attack'||motion==='hit')await settleIdle();
   // Record independently of PNG encoding so short native clips retain all phases.
   await page.evaluate(()=>{
    const w=window as any,p={running:true,last:0,samples:[] as any[]};w.__dragonMotionProof=p;
    w.__dragonProofStep=(now:number)=>{if(!p.running)return;if(now-p.last>=25){p.samples.push(w.__dragonReadSample());p.last=now;}requestAnimationFrame(w.__dragonProofStep);};
    requestAnimationFrame(w.__dragonProofStep);
   });
   await page.locator(`#creature-gallery-${motion}`).click();
   const samples:any[]=[],frames:string[]=[],phaseFrames=new Set<number>();
   let previous:any=null,clipTravel=0,wraps=0,recovery=false;
   const motionStarted=Date.now();
   for(let i=0;;i++){
    if(i>0)await page.waitForTimeout(100);
    const sample=await readSample();checkSample(id,motion,sample);const m=sample.motion;
    if(i===0){
     if(motion==='hit')assert(m.hitOverlay?.active&&m.hitOverlay.bones.length>0&&m.motion==='idle',`${id}/hit: no isolated production recoil after attack`);
     else assert(m.motion===motion,`${id}/${motion}: real control did not select requested motion`);
    }
    if(previous?.clip===m.clip&&m.motion===motion){
     const delta=m.time-previous.time;
     if(delta<0){clipTravel+=delta+m.duration;wraps++;}else clipTravel+=delta;
    }
    samples.push(sample);
    if(motion==='attack'&&m.motion==='idle'&&m.clip==='Idle')recovery=true;
    if(motion==='hit'&&!m.hitOverlay)recovery=true;
    const phase=motion==='hit'?(m.hitOverlay?.time??1)/(m.hitOverlay?.duration??1):motion==='attack'?m.motion==='attack'?m.time/m.duration:1:motion==='walk'||motion==='run'?clipTravel/m.duration:i/3;
    const frameIndex=recovery?3:phase<.30?0:phase<.68?1:2;
    if(!phaseFrames.has(frameIndex)){
     phaseFrames.add(frameIndex);
     const frame=`${out}/${id}-${motion}${['-start','','-late','-recovery'][frameIndex]}.png`;
     await page.screenshot({path:frame});frames.push(frame);
    }
    previous=m;
    if((motion==='walk'||motion==='run')&&clipTravel>=m.duration*1.20&&wraps>=1)break;
    if(motion==='idle'&&i>=3)break;
    if((motion==='attack'||motion==='hit')&&recovery){
     await page.waitForTimeout(180);const settled=await readSample();checkSample(id,motion,settled);
     assert(settled.motion.motion==='idle'&&!settled.motion.hitOverlay,`${id}/${motion}: recovery did not settle`);
     samples.push(settled);break;
    }
    // Attack began from Idle. Do not press another gallery motion here: the
    // explicit authoring control intentionally overrides an active one-shot.
    assert(Date.now()-motionStarted<9000,`${id}/${motion}: full motion did not complete within 9 seconds`);
   }
   const frameSamples=await page.evaluate(()=>{const p=(window as any).__dragonMotionProof;p.running=false;return p.samples;});
   const first=frameSamples.findIndex((s:any)=>motion==='hit'?s.motion.hitOverlay?.active:s.motion.motion===motion);
   assert(first>=0,`${id}/${motion}: frame sampler missed requested action`);
   samples.splice(0,samples.length,...frameSamples.slice(first));
   clipTravel=0;wraps=0;previous=null;
   for(const sample of samples){
    checkSample(id,motion,sample);const m=sample.motion;
    if(previous?.clip===m.clip&&m.motion===motion){const delta=m.time-previous.time;if(delta<0){clipTravel+=delta+m.duration;wraps++;}else clipTravel+=delta;}
    previous=m;
   }
   assert(new Set(samples.map(s=>JSON.stringify(s.motion))).size>1,`${id}/${motion}: animation frozen`);
   const active=samples.filter(s=>s.motion.motion===motion),duration=active[0]?.motion.duration??null;
   const coverage={clipSeconds:duration,sampledClipSeconds:clipTravel,wraps,recovery,firstClipTime:active[0]?.motion.time??null,lastClipTime:active.at(-1)?.motion.time??null};
   evidence.push({id,motion,coverage,frames,samples});
   if(motion==='walk'||motion==='run')assert(clipTravel>=duration*1.05&&wraps>=1,`${id}/${motion}: frame sampler did not record a full cycle`);
   if(motion==='attack')assert(recovery&&active[0].motion.time<duration*.25&&active.at(-1).motion.time>duration*.75,`${id}/attack: onset, full protected action and recovery were not observed`);
  }
  if(emittingOnly||materialOnly){
   await page.locator('#creature-gallery-walk').click();
   await page.evaluate(deep=>(window.__gameDebug as any).inspectPose({x:deep?5.2:2.1,y:0,z:70,yaw:1.18,pitch:.38,distance:deep?11:8}),deep);
   await page.waitForTimeout(350);await page.screenshot({path:`${out}/${id}-side-walk.png`});
   evidence.push({id,side:await readSample()});
  }
 }
 // Real player input proves incoming damage and hit response on the dragon.
 // Gallery attack cycles do not establish outgoing dragon contact timing.
 if(!materialOnly){
 const combatId=ids.length===1?ids[0]!:ids[deep?2:0]!;
 await page.evaluate(async({id,deep})=>{const lab=window.__featureLab!;await lab.perform('reset-player');lab.setFreeCameraEnabled(false);lab.setLevel('melee',99);lab.setLevel('magic',99);await lab.spawnTarget('creature',`candidate:${id}`,{distance:deep?8:4});},{id:combatId,deep});
 await page.keyboard.press('l');const before=await page.evaluate(()=>window.__featureLab!.getState());
 await page.getByRole('button',{name:'Attack spawned creature',exact:true}).click();
 await page.waitForFunction(hp=>(window.__featureLab!.getState().target?.health??hp)<hp,before.target!.health!,{timeout:10000});
 evidence.push({id:combatId,check:'Real player attack causes incoming dragon damage; no outgoing attack/contact synchronization claim.',combatBefore:before,combatAfter:await page.evaluate(()=>window.__featureLab!.getState())});
 }
 assert.deepEqual(driver.consoleErrors,[]);assert.deepEqual(driver.pageErrors,[]);assert.deepEqual(await driver.callDebug('getErrors'),[]);passed=true;
}finally{
 const catalog=JSON.parse(await readFile('test-results/wilderness-dragons/catalog.json','utf8'));
 await writeFile(`${out}/report.json`,JSON.stringify({passed,elapsedMs:Date.now()-started,proofScope:materialOnly?'Material key poses and unobstructed side silhouettes under settled regional lighting. Accepted full-cycle geometry/motion evidence remains in lab-shallow-full and lab-deep-full reports.':'Stationary production-gallery gait cycles, protected attack completion, masked hit recovery, and incoming damage from real player input. Outgoing dragon attack/contact timing is not established.',candidateHashes:Object.fromEntries(catalog.assets.map((a:any)=>[a.id,a.sha256])),evidence,consoleErrors:driver.consoleErrors,pageErrors:driver.pageErrors},null,2));
 await driver.close();await server.close();clearDeadline();
}
