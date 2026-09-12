import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
// @ts-expect-error plain server helper
import { startServer } from '../animals/serve.mjs';
const server=await startServer(),browser=await chromium.launch({headless:true});
try {const page=await browser.newPage();await page.goto(server.url+'/tools/animals/convert.html');const name=process.argv[2];const data=await page.evaluate(async name=>{
// @ts-expect-error browser module
const c=await import('/tools/fab-armor/paragon-convert.js');return c.inspect(name);},name);await writeFile(`test-results/fab-armor-paragon/${name}-components.json`,JSON.stringify(data,null,2));for(const m of data){console.log(m.materials,m.triangles);for(const c of m.components)console.log(c.triangles,c.min.map((x:number)=>x.toFixed(2)),c.max.map((x:number)=>x.toFixed(2)),c.bones.slice(0,2));}}finally{await browser.close();await server.close();}
