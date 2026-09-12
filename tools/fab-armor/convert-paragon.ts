import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
// @ts-expect-error plain server helper
import { startServer } from '../animals/serve.mjs';
const names:Record<string,string>={'melee-t50':'duskguard','melee-t70':'oathguard','melee-t90':'frostguard','mage-t50':'tideweave','mage-t70':'nightweave','mage-t90':'frostweave'};
const sourceMapping:Record<string,string>={'melee-t50':'melee-t50-novaborn','melee-t70':'melee-t50','mage-t50':'mage-t50-rosewood'};
const name=process.argv[2]??'melee-t50',sourceName=process.argv[3]??sourceMapping[name]??name;
const outputDirectory=!process.argv[3]?'.asset-cache/fab-armor/adapted-paragon':'.asset-cache/fab-armor/adapted-paragon/'+sourceName;
const server=await startServer(),browser=await chromium.launch({headless:true});
try{const page=await browser.newPage();await page.goto(server.url+'/tools/animals/convert.html');
await mkdir('test-results/fab-armor-paragon',{recursive:true});await mkdir(outputDirectory,{recursive:true});
for(const gender of ['male','female']){
const result=await page.evaluate(async ({name,gender,sourceName})=>{
// @ts-expect-error browser module
const c=await import('/tools/fab-armor/paragon-convert.js');return c.convert(name,gender,sourceName);},{name,gender,sourceName});
const assets:any[]=[];
for(const [slot,data] of Object.entries(result.output) as [string,any][]){const id=`fab_${gender}_${names[name]}_${slot}`,raw=Buffer.from(data.bytes,'base64'),io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.readBinary(raw);await doc.transform(weld(),textureCompress({encoder:sharp,targetFormat:'webp',quality:85}));const bytes=Buffer.from(await io.writeBinary(doc));await writeFile(`${outputDirectory}/${id}.glb`,bytes);assets.push({id,file:`models/character/fab-armor/${id}.glb`,pack:name.startsWith('melee')?'fab-paragon-greystone':'fab-paragon-kwang',category:'character',is:'armor',tags:['armor',gender,slot,names[name],'rigged'],bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),size:{x:data.bounds.max[0]-data.bounds.min[0],y:data.bounds.max[1]-data.bounds.min[1],z:data.bounds.max[2]-data.bounds.min[2]},base:{x:data.bounds.min[0],y:data.bounds.min[1],z:data.bounds.min[2]},animations:[],materials:[...new Set(result.report.components.filter((c:any)=>c.slot===slot).map((c:any)=>c.material+(c.role?'__fab_'+c.role:'')))]});console.log(id,bytes.length);}
await writeFile(`test-results/fab-armor-paragon/${name}-${sourceName}-${gender}.json`,JSON.stringify(result.report,null,2));await writeFile(`${outputDirectory}/candidates-${name}-${gender}.json`,JSON.stringify({assets,files:Object.fromEntries(assets.map(a=>[a.id,a.id+'.glb'])),pack:{id:name.startsWith('melee')?'fab-paragon-greystone':'fab-paragon-kwang',name:name.startsWith('melee')?'Paragon: Greystone':'Paragon: Kwang',author:'Epic Games',source:'Epic Games Launcher VaultCache',license:'Fab Standard License (user supplied)'}},null,2));
}
}finally{await browser.close();await server.close();}








