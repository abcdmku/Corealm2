import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const id = process.argv[2] || 'cinder_ravager';
const folder = `test-results/creature-expansion/sources/monsters/${({cinder_ravager:'cinder',basalt_drake:'basalt',gorge_mantis:'review-mantis',quarry_nightmare:'review-nightmare'})[id]}`;
await fs.mkdir(folder,{recursive:true});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 740 } });
page.on('pageerror', e => console.log('PAGE', e.message));
await page.goto(`http://127.0.0.1:${process.env.CREATURE_COMPILER_PORT || 59099}/tools/creature-expansion/convert.html`);
const report = await page.evaluate(async id => {
  const THREE = await import('three');
  const { buildSpecies } = await import('/tools/creature-expansion/monsters.mjs');
  const built = await buildSpecies(id);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x7d8892);
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x595249, 2.3));
  const key = new THREE.DirectionalLight(0xfff5e8, 4); key.position.set(4, 7, 5); scene.add(key);
  scene.add(built.object);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshStandardMaterial({color:0x57574e, roughness:1}));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.012; scene.add(ground);
  const grid = new THREE.GridHelper(20,40,0x9da5a8,0x646e70); grid.position.y=-.006; scene.add(grid);
  const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(1000,740); renderer.setPixelRatio(1); renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1;
  document.body.innerHTML=''; document.body.style.margin='0'; document.body.append(renderer.domElement);
  const mixer = new THREE.AnimationMixer(built.object);
  const camera = new THREE.PerspectiveCamera(38,1000/740,.05,100);
  function pose(name,t) { mixer.stopAllAction(); const action=mixer.clipAction(built.clips.find(c=>c.name===name)); action.setLoop(THREE.LoopOnce,1); action.clampWhenFinished=true; action.play(); mixer.setTime(t); built.object.updateMatrixWorld(true); }
  pose('Idle',0);
  const box = new THREE.Box3().setFromObject(built.object,true), size = box.getSize(new THREE.Vector3());
  const target = box.getCenter(new THREE.Vector3());
  camera.position.copy(target).add(new THREE.Vector3(1.4,.75,1.6).multiplyScalar(Math.max(size.y,size.z)*1.1)); camera.lookAt(target);
  const samples=[];
  const clipFloor=[];
  for(const clip of built.clips){
    let low=Infinity,high=-Infinity;
    for(let i=0;i<=30;i++) { pose(clip.name,clip.duration*i/30); const b=new THREE.Box3().setFromObject(built.object,true); low=Math.min(low,b.min.y); high=Math.max(high,b.min.y); }
    clipFloor.push({name:clip.name,lowest:low,highest:high});
  }
  const attack=built.clips.find(c=>c.name==='Attack');
  for(let i=0;i<=30;i++){pose('Attack',attack.duration*i/30);const hands={};built.object.traverse(n=>{if(n.isBone&&/hand|jaw|head|claw/i.test(n.name))hands[n.name]=n.getWorldPosition(new THREE.Vector3()).toArray()});samples.push({t:attack.duration*i/30,hands});}
  window.previewPose=(name,t)=>{pose(name,t);renderer.render(scene,camera);};
  window.previewPose('Idle',.1);
  return {meta:built.meta,size:size.toArray(),box,clips:built.clips.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length})),clipFloor,samples};
}, id);
await fs.writeFile(`${folder}/built-probe.json`,JSON.stringify(report,null,2));
for(const [name,fraction] of [['Idle',.1],['Walk',.25],['Run',.25],['Attack',report.meta.contactNormalized],['Death',.98]]){
 const duration=report.clips.find(c=>c.name===name).duration;
 await page.evaluate(([n,t])=>window.previewPose(n,t),[name,duration*fraction]);
 await page.screenshot({path:`${folder}/${name}.png`});
}
if(process.argv[3]==='gait') {
 const {default:sharp}=await import('sharp');
 for(const name of ['Walk','Run']) {
  const frames=[];
  for(let i=0;i<8;i++) {
   await page.evaluate(([n,t])=>window.previewPose(n,t),[name,report.clips.find(clip=>clip.name===name).duration*i/8]);
   const raw=await page.screenshot();
   frames.push({input:await sharp(raw).resize(500,370).toBuffer(),left:(i%4)*500,top:Math.floor(i/4)*400+30});
   frames.push({input:Buffer.from(`<svg width="500" height="30"><rect width="500" height="30" fill="#18212b"/><text x="14" y="21" fill="white" font-size="16">${name} phase ${i}/8</text></svg>`),left:(i%4)*500,top:Math.floor(i/4)*400});
  }
  await sharp({create:{width:2000,height:800,channels:4,background:'#18212b'}}).composite(frames).png().toFile(`${folder}/${name}-gait-sheet.png`);
 }
}
console.log(JSON.stringify({meta:report.meta,size:report.size,clips:report.clips,clipFloor:report.clipFloor},null,2));
await browser.close();
