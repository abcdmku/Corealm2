import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import {SPECIES} from '../mammals.mjs';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1100,height:850}});
page.on('pageerror',e=>console.log('PAGE',e.message));
await page.goto(process.env.CREATURE_COMPILER_URL||'http://127.0.0.1:60588/tools/creature-expansion/convert.html');
for(const id of process.argv[2]?[process.argv[2]]:SPECIES){
 const folder=`test-results/creature-expansion/mammals/${id}`;await fs.mkdir(folder,{recursive:true});
 const clips=await page.evaluate(async id=>{
  const THREE=await import('three'),{buildSpecies}=await import('/tools/creature-expansion/mammals.mjs?preview='+Date.now());
  const built=await buildSpecies(id),scene=new THREE.Scene();scene.background=new THREE.Color('#92999b');
  scene.add(new THREE.HemisphereLight('#d9ebf4','#625648',2));
  const sun=new THREE.DirectionalLight('#fff0d7',3);sun.position.set(3,5,4);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.00025;sun.shadow.normalBias=.015;scene.add(sun);
  scene.add(built.object);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:'#656b5e',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.001;ground.receiveShadow=true;scene.add(ground);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1100,850);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  document.body.innerHTML='';document.body.style.margin='0';document.body.append(renderer.domElement);
  const mixer=new THREE.AnimationMixer(built.object),camera=new THREE.PerspectiveCamera(37,1100/850,.03,50);
  const box=new THREE.Box3().setFromObject(built.object,true),size=box.getSize(new THREE.Vector3()),centre=box.getCenter(new THREE.Vector3()),extent=Math.max(size.x,size.y,size.z);
  window.mammalPose=(name,fraction,view='front')=>{
   mixer.stopAllAction();const clip=built.clips.find(x=>x.name===name),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.reset().play();mixer.setTime(clip.duration*fraction);built.object.updateMatrixWorld(true);
   const offset=view==='side'?new THREE.Vector3(3.5,1.0,.2):view==='rear'?new THREE.Vector3(-2.7,1.6,-3.1):new THREE.Vector3(2.6,1.4,3.1);camera.position.copy(centre).addScaledVector(offset,extent*.47);camera.lookAt(centre);
   if(view==='feet'){const target=built.object.getObjectByName('FL_Paw').getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(-.05,.025,0));camera.position.copy(target).add(new THREE.Vector3(.37,.24,.48));camera.lookAt(target);}
   renderer.render(scene,camera);
  };
  window.mammalPose('Idle',0);
  return built.clips.map(c=>({name:c.name,duration:c.duration}));
 },id);
 for(const [name,fraction,view] of [['Idle',0,'front'],['Idle',0,'side'],['Idle',0,'rear'],['Idle',0,'feet'],['Walk',.20,'side'],['Run',.32,'side'],['Attack',.46,'front'],['Death',1,'front']]){
  await page.evaluate(args=>window.mammalPose(...args),[name,fraction,view]);await page.screenshot({path:`${folder}/${name}-${view}.png`});
 }
 console.log(JSON.stringify({id,clips}));
}
await browser.close();
