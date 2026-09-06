import {installAssetCandidates} from '../../lib/assetCandidates.ts';
import {installTestDeadline} from '../../lib/deadline.ts';
import {chromium} from 'playwright';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {FEATURE_LAB_CATALOG,createFeatureLabEntity} from '../../../game/src/featureLab/catalog.ts';
const output=process.env.CANDIDATE_OUTPUT??'test-results/finish-quadrupeds-catalogue';
const audit=JSON.parse(await readFile('art/rebuild/candidates/finish-quadrupeds/source-audit.json','utf8'));
const served=JSON.parse(await readFile('game/public/assets/manifest.json','utf8')).assets;
const candidateCatalogue=process.env.CANDIDATE_CATALOGUE??'art/rebuild/candidates/finish-quadrupeds/review-catalogue.json';
const requestedViews=process.env.CANDIDATE_VIEWS?.split(',');
if(requestedViews?.some(view=>!['front','side','rear','gameplay','run','walk'].includes(view)))throw Error('Unknown candidate review view');
const proposed=JSON.parse(await readFile(candidateCatalogue,'utf8')).assets;
const wanted=new Set(process.argv.slice(2).length?process.argv.slice(2):audit.assets.map(a=>a.id));
const presets=FEATURE_LAB_CATALOG.targets.creature.map(preset=>({preset:preset.id,asset:createFeatureLabEntity(preset,{entityId:'audit',groundPosition:[0,0,70],baseY:0}).view.assetId}));
const unique=[...wanted].map(asset=>presets.find(p=>p.asset===asset)).filter(Boolean);
await mkdir(output,{recursive:true});
const clearDeadline=installTestDeadline('Quadruped candidate gallery');
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],records=[];
 page.on('pageerror',e=>errors.push(e.message));
 await installAssetCandidates(page,candidateCatalogue);
 await page.goto((process.env.LAB_URL??'http://127.0.0.1:4175/')+'?mode=combat&creatures=1',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__creatureGallery?.getState().ready,{timeout:60000});
 const renderer=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(e?e.UNMASKED_RENDERER_WEBGL:gl.RENDERER);});
 if(!renderer||/swiftshader|software|llvmpipe/i.test(renderer))throw Error(`Hardware renderer required: ${renderer}`);
 for(const entry of unique){
  await page.evaluate(id=>window.__creatureGallery.show(id,1),entry.preset);
  await page.waitForFunction(id=>document.querySelector('#creature-gallery-preset')?.value===id,entry.preset);
  const views=[['front',0,.16,1.4,2.8],['side',Math.PI/2,.16,1.4,2.8],['rear',Math.PI,.16,1.4,2.8],['gameplay',.35,.52,2,8],['run',Math.PI/2,.16,1.4,2.8]],viewStates=[];
  if(process.env.SOURCE_NATIVE_PREVIEW==='1')views.push(['walk',Math.PI/2,.16,1.4,2.8]);
  for(const [view,yaw,pitch,mult,distance]of views){
   if(requestedViews&&!requestedViews.includes(view))continue;
   const candidate=proposed.find(a=>a.id===entry.asset)??served.find(a=>a.id===entry.asset);
   if(process.env.SOURCE_NATIVE_PREVIEW==='1'&&(view==='run'||view==='walk')&&!candidate.animations?.some(name=>new RegExp(view,'i').test(name)))continue;
   await page.evaluate(({yaw,pitch,mult,distance,view})=>{const b=window.__creatureGallery.getBounds(),size=Math.max(...b.max.map((v,i)=>v-b.min[i]));window.__gameDebug.inspectPose({x:(b.min[0]+b.max[0])/2,y:(b.min[1]+b.max[1])/2,z:(b.min[2]+b.max[2])/2,yaw,pitch,distance:Math.max(distance,size*mult),detached:true});if(view==='run'||view==='walk')window.__creatureGallery.play(view);},{yaw,pitch,mult,distance,view});
   await page.waitForTimeout(160);
   await page.screenshot({path:`${output}/${entry.asset}-${view}.png`});
   viewStates.push({view,...await page.evaluate(()=>{const state=window.__creatureGallery.getState();return {state,motion:window.__gameDebug.getEntityMotion(state.entityIds[0])};})});
  }
  records.push({...entry,assetMetadata:proposed.find(a=>a.id===entry.asset)??served.find(a=>a.id===entry.asset),views:viewStates,state:await page.evaluate(()=>window.__creatureGallery.getState())});
  console.log(JSON.stringify({captured:entry.asset}));
 }
 await writeFile(`${output}/gallery.json`,JSON.stringify({renderer,candidateCatalogue,records,errors,missing:[...wanted].filter(id=>!unique.some(p=>p.asset===id)),scope:'Selected assets in the production gallery, with staged candidate replacements pinned by metadata. Per-view state records actual active clips. This proves neither AI lifecycle nor runtime travel.'},null,2));
}finally{await browser.close();clearDeadline();}
