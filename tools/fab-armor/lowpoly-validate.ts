import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
// @ts-expect-error plain server helper
import { startServer } from '../animals/serve.mjs';
const server = await startServer();
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.addInitScript('window.__name = f => f;');
  await page.goto(server.url+'/tools/animals/convert.html');
  const report = await page.evaluate(async () => {
    // @ts-expect-error browser import
    const THREE = await import('/node_modules/three/build/three.module.js');
    // @ts-expect-error browser import
    const {GLTFLoader} = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader(), results=[];
    for(const gender of ['male','female']){
      const host=(await loader.loadAsync(`/game/public/assets/models/character/base_${gender}.glb`)).scene;
      host.updateMatrixWorld(true);const hostBones=new Map();host.traverse((o:any)=>{if(o.isBone)hostBones.set(o.name,o);});
      for(const part of ['head','body','legs','hands','feet']){
        const id=`fab_${gender}_mage_${part}`;
        const model=(await loader.loadAsync(`/.asset-cache/fab-armor/lowpoly/${id}.glb`)).scene;
        model.updateMatrixWorld(true);
        let maxRestError=0,maxHostInverseError=0,maxWeightError=0,nonFinite=0,vertices=0;const missing=new Set<string>(),materials: string[]=[];
        model.traverse((o:any)=>{
          if(!o.isSkinnedMesh)return;
          materials.push(o.material.name);o.skeleton.update();
          for(let k=0;k<o.skeleton.bones.length;k++){
            const bone=o.skeleton.bones[k],target:any=hostBones.get(bone.name);
            if(!target){missing.add(bone.name);continue;}
            const identity=target.matrixWorld.clone().multiply(o.skeleton.boneInverses[k]);
            for(let j=0;j<16;j++)maxHostInverseError=Math.max(maxHostInverseError,Math.abs(identity.elements[j]-(j%5===0?1:0)));
          }
          const position=o.geometry.attributes.position,weights=o.geometry.attributes.skinWeight;
          vertices+=position.count;
          for(let i=0;i<position.count;i++){
            const raw=new THREE.Vector3().fromBufferAttribute(position,i),posed=o.getVertexPosition(i,new THREE.Vector3());
            maxRestError=Math.max(maxRestError,raw.distanceTo(posed));
            let sum=0;for(let k=0;k<4;k++)sum+=weights.array[i*4+k];
            maxWeightError=Math.max(maxWeightError,Math.abs(sum-1));
            if(!raw.toArray().concat(posed.toArray()).every(Number.isFinite))nonFinite++;
          }
        });
        results.push({id,vertices,materials,missingBones:[...missing],maxRestError,maxHostInverseError,maxWeightError,nonFinite});
      }
    }
    return results;
  });
  await writeFile('test-results/fab-armor-lowpoly/validation.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.some((r:any)=>r.nonFinite||r.missingBones.length||r.maxRestError>1e-5||r.maxHostInverseError>1e-5||r.maxWeightError>1e-5))throw new Error('Lowpoly bind validation failed');
} finally {await browser.close();await server.close();}

