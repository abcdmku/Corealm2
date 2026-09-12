import { GameDriver } from './lib/driver.js';
import { mkdir, writeFile } from 'node:fs/promises';
const d = new GameDriver({url:'http://127.0.0.1:4397',close:async()=>{}},{browserArgs:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
await mkdir('test-results/fairy-terraces',{recursive:true});
try { await d.launch(); for (const [name,route] of [['lab','/index.html?mode=combat&environment=1&atmosphere=1&startup-cache=0'],['world','/index.html?startup-cache=0']]) { await d.open(60000,route); const s=await d.snapshot(); await writeFile(`test-results/fairy-terraces/baseline-${name}.json`,JSON.stringify(s,null,2)); await d.screenshot('test-results/fairy-terraces',`baseline-${name}`); console.log(name,JSON.stringify(s.state)); }} catch(e) {console.log(String(e));console.log(await d.page?.locator('body').innerText());} finally {console.log(JSON.stringify({console:d.consoleErrors,page:d.pageErrors,requests:d.requestErrors}));await d.close();}
