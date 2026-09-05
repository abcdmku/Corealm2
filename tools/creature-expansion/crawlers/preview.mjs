// Source sculpture preview only. This does not run the production feature lab.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const id = process.argv[2] ?? 'antler_beetle';
const mode=process.argv.includes('--joints')?'joints':process.argv.includes('--motion')?'motion':'source-preview';
const width=mode==='source-preview'?1440:1680,height=mode==='source-preview'?700:840;
const output = path.resolve(root, `test-results/creature-expansion/crawlers/${id}-${mode}.png`);
await mkdir(path.dirname(output),{recursive:true});
const html = `<!doctype html><html><head><meta charset="UTF-8"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script></head><body style="margin:0"><script type="module">
import * as THREE from 'three';import { buildSpecies } from '/tools/creature-expansion/crawlers.mjs';
const data=await buildSpecies(${JSON.stringify(id)}), scene=new THREE.Scene();scene.background=new THREE.Color('#777e78');scene.add(data.object);
scene.add(new THREE.HemisphereLight(0xd8e6ec,0x424630,2));const sun=new THREE.DirectionalLight(0xffedda,3.3);sun.position.set(-3,6,5);scene.add(sun);
const plane=new THREE.Mesh(new THREE.PlaneGeometry(15,15),new THREE.MeshStandardMaterial({color:0x636d5c,roughness:.95}));plane.rotation.x=-Math.PI/2;plane.position.y=-.009;scene.add(plane);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(${width},${height});renderer.setPixelRatio(1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.appendChild(renderer.domElement);
const b=new THREE.Box3().setFromObject(data.object),size=b.getSize(new THREE.Vector3()),target=b.getCenter(new THREE.Vector3());target.y=.44;const distance=Math.max(size.x,size.z)*2.25;
const camera=new THREE.PerspectiveCamera(34,480/700,.01,100);renderer.setScissorTest(true);
if(${JSON.stringify(mode)}==='source-preview'){
 for(let i=0;i<3;i++){const poses=[[.65,.73,1],[-1,.36,.70],[.20,1.8,.20]],p=poses[i];camera.position.copy(target).add(new THREE.Vector3(...p).normalize().multiplyScalar(distance));camera.lookAt(target);renderer.setViewport(i*480,0,480,700);renderer.setScissor(i*480,0,480,700);renderer.render(scene,camera);}
}else{
 const mixer=new THREE.AnimationMixer(data.object),poses=[['Idle',.20],['Walk',.31],['Run',.68],['Attack',.50],['Hit',.36],['HitLeft',.42],['HitRight',.42],['Death',1]];camera.aspect=1;camera.updateProjectionMatrix();
 for(let i=0;i<poses.length;i++){const [name,phase]=poses[i],clip=data.clips.find(c=>c.name===name);mixer.stopAllAction();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(clip.duration*phase);data.object.updateMatrixWorld(true);const focus=target.clone();let dist=Math.max(size.x,size.z)*1.95;if(${JSON.stringify(mode)}==='joints'){const knee=data.object.getObjectByName(${JSON.stringify(id)}+'_leg_R_1_tibia');knee.getWorldPosition(focus);dist=1.12;}camera.position.copy(focus).add(new THREE.Vector3(.80,.36,1).normalize().multiplyScalar(dist));camera.lookAt(focus);const x=(i%4)*420,y=420-Math.floor(i/4)*420;renderer.setViewport(x,y,420,420);renderer.setScissor(x,y,420,420);renderer.render(scene,camera);const label=document.createElement('div');label.style.cssText='position:absolute;color:white;font:18px Arial;background:#18251dc9;padding:7px;left:'+x+'px;top:'+(Math.floor(i/4)*420)+'px';label.textContent=name+' · '+Math.round(phase*100)+'%';document.body.appendChild(label);}
}window.ready=true;
</script></body></html>`;
const server = createServer(async (req, res) => {
  if(req.url === '/') { res.setHeader('content-type','text/html');res.end(html);return; }
  try {const url=new URL(req.url,'http://localhost');const resolved=path.resolve(root,`.${decodeURIComponent(url.pathname)}`);if(!resolved.startsWith(root+path.sep))throw new Error('Outside workspace');res.setHeader('content-type','text/javascript');res.end(await readFile(resolved));}
  catch(error){res.statusCode=404;res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try {const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});page.on('pageerror',error=>console.error(error));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.ready===true);await page.screenshot({path:output});console.log(output);}
finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
