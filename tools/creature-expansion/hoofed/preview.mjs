import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const workspace=process.cwd();
const server=http.createServer(async(req,res)=>{try{const file=path.resolve(workspace,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(workspace+path.sep))throw Error('outside workspace');res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'text/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1300,height:1000}});page.on('pageerror',e=>console.error(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/tools/creature-expansion/hoofed/preview.html`);await page.waitForFunction(()=>window.ready);
await fs.mkdir('test-results/creature-expansion/hoofed',{recursive:true});
const selected=process.argv.slice(2);
for(const id of ['marchwild_horse','cairn_bighorn','marsh_moose','bracken_tapir'].filter(id=>!selected.length||selected.includes(id))){
 await page.evaluate(async id=>{await window.pick(id);window.angle(4,2.8,5);},id);await page.screenshot({path:`test-results/creature-expansion/hoofed/${id}.png`});
 for(const clip of ['Run','Attack','Death']){
  await page.evaluate(({clip})=>{const duration=window.current.clips.find(c=>c.name===clip).duration;window.pose(clip,duration*(clip==='Death'?.97:clip==='Attack'?.46:.34));},{clip});
  await page.screenshot({path:`test-results/creature-expansion/hoofed/${id}-${clip}.png`});
 }
 if(id==='marchwild_horse'){
  await page.evaluate(()=>{window.pose('Rest',0);window.angle(2.5,2.6,3.4,[0,1.83,1.08]);});
  await page.screenshot({path:'test-results/creature-expansion/hoofed/marchwild_horse-close.png'});
 }
 if(id==='bracken_tapir'){
  await page.evaluate(()=>{window.pose('Rest',0);window.angle(1.75,.95,1.9,[.10,.30,.65]);});
  await page.screenshot({path:'test-results/creature-expansion/hoofed/bracken_tapir-feet-close.png'});
 }
 if(id==='cairn_bighorn'){
  await page.evaluate(()=>{window.pose('Rest',0);window.angle(2.5,2.15,3.15,[0,1.3,.85]);});
  await page.screenshot({path:'test-results/creature-expansion/hoofed/cairn_bighorn-horns-close.png'});
 }
}
await browser.close();server.close();
