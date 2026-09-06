import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {GameDriver} from '../../../tools/lib/driver.js';
import {installTestDeadline} from '../../../tools/lib/deadline.js';
import {installAssetCandidates} from '../../../tools/lib/assetCandidates.js';
const defaultSelections=['corealm_sunder_ledge','corealm_scree_slide',...['grithe_ore','corven_ore','kaldite_ore','emberite_ore','pale_quartz','vell_amber','cairn_garnet','fire_opal'].map(id=>`corealm_item_${id}`)];
const args=process.argv.slice(2);
let out='test-results/native-prop-review';
let catalog:string|undefined;
let url=process.env.COREALM_URL??`http://127.0.0.1:${process.env.PORT??'4175'}`;
const selections:string[]=[];
for(let index=0;index<args.length;index+=1){
 const arg=args[index]!;
 if(arg==='--url'){
  const value=args[++index];if(!value||value.startsWith('--'))throw new Error('--url requires a value');url=value;
 }else if(arg==='--catalog'){
  catalog=args[++index];if(!catalog||catalog.startsWith('--'))throw new Error('--catalog requires a path');
 }else if(arg==='--out'){
  const value=args[index+1];
  if(!value||value.startsWith('--'))throw new Error('--out requires a path');
  out=value;index+=1;
 }else if(arg.startsWith('--out=')){
  const value=arg.slice('--out='.length);
  if(!value)throw new Error('--out requires a path');
  out=value;
 }else if(arg.startsWith('--'))throw new Error(`Unknown option: ${arg}`);
 else selections.push(arg);
}
if(!selections.length)selections.push(...defaultSelections);

await mkdir(out,{recursive:true});
const clearDeadline=installTestDeadline('Native prop review',60000);
const driver=new GameDriver({url,close:async()=>{}},{headless:true,viewport:{width:1440,height:900},browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const report:any={passed:false,visualAccepted:false,out,selections,shots:[]};
try{
 await driver.launch();
 if(catalog)report.candidates=await installAssetCandidates(driver.page!,catalog);
 await driver.open(20000,'/index.html?mode=combat&environment=1');const page=driver.page!;
 for(const id of selections){
  const options=id==='corealm_sunder_ledge'?{scale:1.2,rotationY:.4}:{};
  await page.evaluate(async({requestedId,requestedOptions})=>{await (window as any).__environmentLab.showGallery(requestedId,requestedOptions);},{requestedId:id,requestedOptions:options});
  await page.waitForFunction(requestedId=>{
   const selection=document.querySelector<HTMLSelectElement>('#environment-lab-selection');
   const source=document.querySelector<HTMLElement>('#environment-lab-source');
   return selection?.value===requestedId&&source?.textContent?.includes(requestedId)===true;
  },id);
  const bounds:any=await page.evaluate(()=>(window as any).__environmentLab.getBounds());assert(bounds);
  const state:any=await page.evaluate(()=>(window as any).__environmentLab.getState());assert(state.ready);assert.equal(state.selection,id);
  const h=bounds.max[1]-bounds.min[1],w=Math.max(bounds.max[0]-bounds.min[0],bounds.max[2]-bounds.min[2]);
  const pose={x:(bounds.min[0]+bounds.max[0])/2,y:(bounds.min[1]+bounds.max[1])/2,z:(bounds.min[2]+bounds.max[2])/2,yaw:.4,pitch:.48,distance:Math.max(id.startsWith('corealm_item_')?.7:2.4,w*2,h*2),detached:true};
  const panelVisibility=await page.evaluate(()=>['#panel-feature-lab','#environment-lab-panel'].map(selector=>{
   const element=document.querySelector<HTMLElement>(selector);
   const visibility=element?.style.visibility??'';
   if(element)element.style.visibility='hidden';
   return {selector,visibility};
  }));
  try{
   await driver.callDebug('inspectPose',[pose]);await driver.wait(150);await driver.screenshot(out,id);
   report.shots.push({name:id,id,view:'primary',options,bounds,state,camera:pose,metrics:await driver.callDebug('getMetrics')});
   if(id==='corealm_sunder_ledge'||id==='corealm_scree_slide'||id.startsWith('corealm_ore_')||id.startsWith('corealm_item_')||/^corealm_(oak|pine)_/.test(id)){
    const oppositePose={...pose,yaw:3.5,pitch:.55};
    await driver.callDebug('inspectPose',[oppositePose]);await driver.wait(150);await driver.screenshot(out,`${id}-opposite`);
    report.shots.push({name:`${id}-opposite`,id,view:'opposite',options,bounds,state,camera:oppositePose,metrics:await driver.callDebug('getMetrics')});
   }
  }finally{
   await page.evaluate(entries=>{for(const {selector,visibility} of entries){const element=document.querySelector<HTMLElement>(selector);if(element)element.style.visibility=visibility;}},panelVisibility);
  }
 }
 report.errors=await driver.callDebug('getErrors');report.console=driver.consoleErrors;report.requests=driver.requestErrors;
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.console,[]);assert.deepEqual(report.requests,[]);report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{await driver.close();clearDeadline();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,count:report.shots.length,out}));}
