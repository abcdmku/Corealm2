import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const $=id=>document.getElementById(id),parts=['hood','robe','leggings','boots','wraps'];
const requested=new URLSearchParams(location.search);
if(['dragonhide','starhide','frostweave'].includes(requested.get('set'))) $('theme').value=requested.get('set');
if(['all',...parts].includes(requested.get('piece'))) $('piece').value=requested.get('piece');
const renderer=new THREE.WebGLRenderer({canvas:$('canvas'),antialias:true});
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;
const scene=new THREE.Scene();scene.background=new THREE.Color('#10151d');
const camera=new THREE.PerspectiveCamera(35,innerWidth/innerHeight,.01,100);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.autoRotateSpeed=.7;
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();scene.environmentIntensity=.5;
scene.add(new THREE.HemisphereLight(0xe4edff,0x18202c,.35));
for(const [x,y,z,power] of [[2,3,4,1.2],[-3,2,1,.5],[1,2,-3,.8]]){
 const light=new THREE.DirectionalLight(0xffffff,power);light.position.set(x,y,z);
 if(x===2){light.castShadow=true;light.shadow.mapSize.set(4096,4096);Object.assign(light.shadow.camera,{left:-1.8,right:1.8,top:1.8,bottom:-1.8,near:.1,far:10});light.shadow.bias=-.00001;light.shadow.normalBias=.00015;}
 scene.add(light);
}
const loader=new GLTFLoader(),cache=new Map();let active=[],sequence=0;
window.armorViewer={ready:false,theme:$('theme').value,piece:$('piece').value,loadedPieces:[],errors:[]};
async function load(theme,part){
 const key=`${theme}/${part}`;if(cache.has(key))return cache.get(key);
 const pending=loader.loadAsync(`/models/${theme}/${part}.glb`).then(gltf=>{
  const root=gltf.scene;root.name=`${theme}_${part}`;root.updateMatrixWorld(true);
  root.traverse(node=>{if(node.isBone)node.userData.restMatrix=node.matrix.clone();if(node.isMesh)node.castShadow=node.receiveShadow=true;});
  cache.set(key,root);return root;
 });cache.set(key,pending);try{return await pending;}catch(e){cache.delete(key);throw e;}
}
function pose(root){
 root.traverse(node=>{if(node.isBone&&node.userData.restMatrix)node.userData.restMatrix.decompose(node.position,node.quaternion,node.scale);});root.updateMatrixWorld(true);
 if(!$('pose').checked)return;
 for(const [name,angle] of [['upperarm_l',-62],['upperarm_r',62]]){
  const bone=root.getObjectByName(name);if(!bone)continue;
  const pivot=bone.getWorldPosition(new THREE.Vector3());
  const transform=new THREE.Matrix4().makeTranslation(...pivot.toArray()).multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(angle))).multiply(new THREE.Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z));
  const world=transform.multiply(bone.matrixWorld.clone()),local=bone.parent.matrixWorld.clone().invert().multiply(world);
  local.decompose(bone.position,bone.quaternion,bone.scale);root.updateMatrixWorld(true);
 }
}
function frame(){
 const box=new THREE.Box3();for(const root of active){root.updateMatrixWorld(true);root.traverse(n=>{if(n.isSkinnedMesh)n.skeleton.update();});box.expandByObject(root,true);}
 if(box.isEmpty())return;const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
 const usableAspect=camera.aspect*.72;const distance=Math.max(size.y,size.x/usableAspect)/2/Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*1.32+size.z*.5;
 controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(.22,.10,1).normalize().multiplyScalar(distance));
 controls.minDistance=.12;controls.maxDistance=distance*5;controls.update();
}
function appearance(){for(const root of active){pose(root);root.traverse(node=>{if(node.isMesh)for(const m of Array.isArray(node.material)?node.material:[node.material])m.wireframe=$('wire').checked;});}}
async function show(){
 const ticket=++sequence,theme=$('theme').value,piece=$('piece').value,chosen=piece==='all'?parts:[piece];
 window.armorViewer.ready=false;$('status').textContent='Loading armor…';
 const ref=piece==='all'?'robe':piece,design=theme==='dragonhide'?'starhide':'dragonhide';$('reference').src=theme==='frostweave'?'/aurora-reference.png':`/refs/${design}_${ref}.png`;$('referenceLink').href=$('reference').src;
 $('referenceTitle').textContent=theme==='frostweave'?'Aurora design reference':`Original ${ref} item image`;$('studio').href=piece==='all'?`/previews/${theme}-studio.png`:`/renders/${theme}_${piece}.png`;
 try{
  const roots=await Promise.all(chosen.map(part=>load(theme,part)));if(ticket!==sequence)return;
  for(const root of active)scene.remove(root);active=roots;for(const root of active)scene.add(root);appearance();frame();
  Object.assign(window.armorViewer,{ready:true,theme,piece,loadedPieces:active.map(root=>root.name)});
  $('status').textContent=`${theme==='dragonhide'?'T50 Dragonhide · Midnight blue':theme==='starhide'?'T70 Starhide · Deep maroon':'T90 Aurora · Ivory and gold'} · ${piece==='all'?'5 pieces':piece} · ready`;
 }catch(error){if(ticket!==sequence)return;$('status').textContent=`Could not load armor: ${error.message}`;window.armorViewer.errors.push(error.message);}
}
$('theme').addEventListener('change',show);$('piece').addEventListener('change',show);$('reset').addEventListener('click',frame);
$('pose').addEventListener('change',()=>{appearance();frame();});$('wire').addEventListener('change',appearance);
$('spin').addEventListener('change',()=>controls.autoRotate=$('spin').checked);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});show();
