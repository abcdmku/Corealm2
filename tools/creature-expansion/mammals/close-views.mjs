import {installAssetCandidates} from '../../lib/assetCandidates.ts';
import {installTestDeadline} from '../../lib/deadline.ts';
import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {FEATURE_LAB_CATALOG,createFeatureLabEntity} from '../../../game/src/featureLab/catalog.ts';

// Close production-gallery inspection of one staged candidate: feet, head and any
// requested clip. Camera targets are fractions of the actor's live drawn bounds, so the
// frames follow the served candidate at its actual gallery position.
// Usage: npx tsx tools/creature-expansion/mammals/close-views.mjs creature_redbrush_fox
// Env: LAB_URL, CANDIDATE_CATALOGUE, CANDIDATE_OUTPUT, CLOSE_VIEWS (json array of
// {name, frac:[fx,fy,fz], yaw, pitch, distance, clip?, settleMs?}).
const asset=process.argv[2];if(!asset)throw Error('Pass one asset id');
const output=process.env.CANDIDATE_OUTPUT??`test-results/close-views/${asset}`;
const catalogue=process.env.CANDIDATE_CATALOGUE;if(!catalogue)throw Error('CANDIDATE_CATALOGUE is required');
const views=JSON.parse(process.env.CLOSE_VIEWS??'[]');if(!Array.isArray(views)||!views.length)throw Error('CLOSE_VIEWS must be a nonempty JSON array');
const presets=FEATURE_LAB_CATALOG.targets.creature.map(preset=>({preset:preset.id,asset:createFeatureLabEntity(preset,{entityId:'audit',groundPosition:[0,0,70],baseY:0}).view.assetId}));
const entry=presets.find(p=>p.asset===asset);if(!entry)throw Error(`No lab preset serves ${asset}`);
await mkdir(output,{recursive:true});
const clearDeadline=installTestDeadline('Candidate close views');
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],records=[];
 page.on('pageerror',e=>errors.push(e.message));
 await installAssetCandidates(page,catalogue);
 await page.goto((process.env.LAB_URL??'http://127.0.0.1:4181/')+'?mode=combat&creatures=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__creatureGallery?.getState().ready,{timeout:60000});
 const renderer=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(e?e.UNMASKED_RENDERER_WEBGL:gl.RENDERER);});
 if(!renderer||/swiftshader|software|llvmpipe/i.test(renderer))throw Error(`Hardware renderer required: ${renderer}`);
 await page.evaluate(id=>window.__creatureGallery.show(id,1),entry.preset);
 await page.waitForFunction(id=>document.querySelector('#creature-gallery-preset')?.value===id,entry.preset);
 for(const view of views){
  const result=await page.evaluate(async view=>{
   const gallery=window.__creatureGallery,debug=window.__gameDebug,state=gallery.getState(),entityId=state.entityIds[0];
   if(view.clip){gallery.play(view.clip);await new Promise(r=>setTimeout(r,120));}
   const b=gallery.getBounds(),f=view.frac??[.5,.5,.5];
   const target={x:b.min[0]+f[0]*(b.max[0]-b.min[0]),y:b.min[1]+f[1]*(b.max[1]-b.min[1]),z:b.min[2]+f[2]*(b.max[2]-b.min[2])};
   debug.inspectPose({...target,yaw:view.yaw,pitch:view.pitch,distance:view.distance,detached:true});
   return {target,bounds:b,motion:debug.getEntityMotion(entityId)};
  },view);
  await page.waitForTimeout(view.settleMs??200);
  await page.screenshot({path:`${output}/${asset}-${view.name}.png`});
  records.push({view,...result});
  console.log(JSON.stringify({captured:view.name,target:result.target,motion:result.motion?.clip}));
 }
 await writeFile(`${output}/close-views.json`,JSON.stringify({renderer,candidateCatalogue:catalogue,asset,records,errors,scope:'Close production-gallery inspection frames. Not lifecycle or motion acceptance.'},null,2));
 if(errors.length)throw Error(errors.join('; '));
}finally{await browser.close();clearDeadline();}
