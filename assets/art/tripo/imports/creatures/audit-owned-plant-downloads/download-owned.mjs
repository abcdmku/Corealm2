import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const owner='assets/art/tripo/imports/creatures/audit-owned-plant-downloads';
const models=[
 {id:'eab6d009-e9e3-4685-ad92-370117420c63',name:'mooncap-fungus'},
 {id:'64833df9-8eee-437f-9010-9ca3483dc015',name:'thicketwalker'},
 {id:'a35c5493-c162-4927-a59c-028f5b6508e6',name:'leafarmed-plant'},
 {id:'7508cd34-a17e-4945-8c38-e6ae4542f4b2',name:'pinkbud-plant'},
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const browser=await chromium.connectOverCDP('http://127.0.0.1:9333');
const context=browser.contexts()[0];
if(!context)throw new Error('No logged-in Chrome context');
const page=await context.newPage();
const records=[];
try{
 for(const {id,name} of models){
  await page.goto(`https://studio.tripo3d.ai/3d-model/m-${id}`,{waitUntil:'domcontentloaded'});
  let project=null;
  for(let i=0;i<40&&!project;i++){
   project=await page.evaluate(id=>{const p=document.querySelector('#__nuxt')?.__vue_app__?.config.globalProperties.$pinia.state.value['3d-model-store']?.project;return p?.id===id?JSON.parse(JSON.stringify(p)):null},id).catch(()=>null);
   if(!project)await page.waitForTimeout(250);
  }
  if(!project||!project.is_owner||project.operator?.status!=='success'||!project.model_url?.includes('.glb'))throw new Error(`${id}: no completed owned GLB`);
  const file=`${owner}/${name}-${id}.glb`;
  let bytes=await readFile(file).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  if(!bytes){
   const response=await fetch(project.model_url);
   if(!response.ok)throw new Error(`${id}: signed GLB fetch returned ${response.status}`);
   bytes=Buffer.from(await response.arrayBuffer());
  }
  if(bytes.length<20||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw new Error(`${id}: invalid GLB response`);
  await writeFile(file,bytes);
  const record={id,name,file,bytes:bytes.length,sha256:sha(bytes),detailUrl:page.url(),sourceCdnPath:project.model_url.split('?')[0],operatorType:project.operator.type,operatorStatus:project.operator.status,operatorId:project.operator.operator_id,
   projectName:project.project_name,sourcePrompt:project.biz_info?.description||null};
  records.push(record);
  console.log(JSON.stringify({id,file,bytes:bytes.length,sha256:record.sha256,operatorType:record.operatorType}));
 }
}finally{await page.close();await browser.close();}
await writeFile(`${owner}/download-provenance.json`,JSON.stringify({schema:'corealm-tripo-owned-downloads/1',downloadedAtUtc:new Date().toISOString(),records},null,2)+'\n');
