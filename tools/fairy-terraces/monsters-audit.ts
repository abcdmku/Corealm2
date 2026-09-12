/** Structural and sampled deformation audit. This does not establish production lab acceptance. */
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { deformedBounds } from '../creature-motion/validate-deformation.js';
import { applyClip, duration, restorePose, storedPose } from '../creature-motion/pose.js';

const directory='test-results/fairy-terraces-assets/monsters';
const catalog=JSON.parse(await readFile(`${directory}/candidates.json`,'utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS), reports=[];
for(const asset of catalog.assets) {
  const doc=await io.read(`${directory}/${catalog.files[asset.id]}`),pose=storedPose(doc), failures=[];
  for(const n of doc.getRoot().listNodes()) {
    const skin=n.getSkin();if(!skin)continue;
    for(const p of n.getMesh()?.listPrimitives()??[]) {
      const weights=p.getAttribute('WEIGHTS_0'),joints=p.getAttribute('JOINTS_0');
      if(!weights||!joints)throw Error(`${asset.id} incomplete skin attributes`);
      for(let i=0;i<weights.getCount();i++) {
        const w=weights.getElement(i,[]),j=joints.getElement(i,[]);
        if(Math.abs(w.reduce((s,v)=>s+v,0)-1)>.002||w.some(v=>v<0))failures.push(`Invalid weight ${i}`);
        if(j.some((v,k)=>w[k]!>0&&(!Number.isInteger(v)||v>=skin.listJoints().length)))failures.push(`Invalid joint ${i}`);
      }
    }
  }
  const clips=[];
  for(const name of ['Idle','Walk','Run','Attack','Hit','Death']) {
    const clip=doc.getRoot().listAnimations().find(c=>c.getName()===name);
    if(!clip){failures.push(`Missing ${name}`);continue;}
    let minimum=Infinity,maximum=-Infinity,rootTravel=0,firstRoots:number[][]|undefined;
    const roots=doc.getRoot().listNodes().filter(n=>['root','rootx'].includes(n.getName()));
    for(let i=0;i<=24;i++) {
      restorePose(pose);applyClip(clip,duration(clip)*i/24);const bounds=deformedBounds(doc);
      minimum=Math.min(minimum,bounds.min[1]!);maximum=Math.max(maximum,bounds.max[1]!);
      const positions=roots.map(n=>{const m=n.getWorldMatrix();return [m[12]!,m[13]!,m[14]!];});
      firstRoots??=positions;
      rootTravel=Math.max(rootTravel,...positions.map((p,k)=>Math.hypot(p[0]!-firstRoots![k]![0]!,p[2]!-firstRoots![k]![2]!)));
    }
    if(minimum<-.015)failures.push(`${name} penetrates ground ${minimum.toFixed(4)}m`);
    if(rootTravel>.005 && name!=='Death')failures.push(`${name} displaces root ${rootTravel.toFixed(4)}m`);
    clips.push({name,seconds:duration(clip),minimumGroundY:minimum,maximumHeightY:maximum,rootHorizontalTravelM:rootTravel});
  }
  restorePose(pose);
  const report={id:asset.id,passed:failures.length===0,failures,clips};reports.push(report);
  console.log(JSON.stringify({id:asset.id,passed:report.passed,failures}));
}
await writeFile(`${directory}/deformation-audit.json`,JSON.stringify({passed:reports.every(r=>r.passed),reports},null,2)+'\n');
if(reports.some(r=>!r.passed))process.exitCode=1;
