import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const workspace=process.cwd(),output=path.join(workspace,'test-results/creature-expansion/reptiles');
const server=http.createServer(async(req,res)=>{try{const file=path.resolve(workspace,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(workspace+path.sep))throw Error('outside workspace');res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'text/javascript');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1400,height:1050}});page.on('pageerror',e=>console.error(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/tools/creature-expansion/reptiles/preview.html`);await page.waitForFunction(()=>window.ready);await fs.mkdir(output,{recursive:true});
 const args=process.argv.slice(2),roundTrip=args.includes('--roundtrip'),species=args.filter(a=>!a.startsWith('--'));
 for(const id of species.length?species:['slateback_tortoise','ashscale_monitor']) {
  await page.evaluate(async id=>{await window.pick(id);window.angle('hero');},id);
  if(roundTrip)console.log(await page.evaluate(()=>window.roundTrip()));
  const suffix=roundTrip?'-roundtrip':'';
  for(const angle of ['hero','side','front','rear']){await page.evaluate(angle=>window.angle(angle),angle);await page.screenshot({path:path.join(output,`${id}-${angle}${suffix}.png`)});}
  for(const name of ['Run','Attack','Death']){await page.evaluate(name=>{const clip=window.current.clips.find(c=>c.name===name);window.pose(name,clip.duration*(name==='Death'?1:name==='Attack'?.49:.34));window.angle('hero');},name);await page.screenshot({path:path.join(output,`${id}-${name}${suffix}.png`)});}
  console.log(JSON.stringify({id,output}));
 }
} finally {await browser.close();server.close();}
