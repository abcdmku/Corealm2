import { chromium } from 'playwright';
import { writeFile, mkdir, copyFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// @ts-expect-error plain server helper
import { startServer } from '../animals/serve.mjs';

const parts = process.argv.includes('--all') ? ['body','legs','helmet','gauntlets','boots'] : ['body'];
const genders = process.argv.includes('--all') ? ['Male','Female'] : ['Male'];
const slots: Record<string,string> = { body:'body',legs:'legs',helmet:'head',gauntlets:'hands',boots:'feet' };
const assets: any[] = [], files: Record<string,string> = {};
const sourceRoot = process.env.FAB_LOWPOLY_SOURCE ?? 'C:/ProgramData/Epic/EpicGamesLauncher/VaultCache/LowpolyM1da6d6f97a10V1/data/Content/Polytope_Studio/Modular_Armors';
await mkdir('.asset-cache/fab-armor/lowpoly',{recursive:true});
for (const name of ['Cloth','Leather','Metal','Skin_Eye_Hair']) await copyFile(`${sourceRoot}/Textures/PT_Armors_${name}_Mask_01.png`,`.asset-cache/fab-armor/lowpoly/PT_Armors_${name}_Mask_01.png`);
for (const gender of genders) for (const part of parts) await copyFile(`${sourceRoot}/Meshes/Separate_Parts/SK_${gender}_Armor_05_C_${part}.fbx`,`.asset-cache/fab-armor/lowpoly/SK_${gender}_Armor_05_C_${part}.fbx`);
const server = await startServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(server.url + '/tools/animals/convert.html');
  await mkdir('test-results/fab-armor-lowpoly',{recursive:true});
  for (const gender of genders) for (const part of parts) {
    const result = await page.evaluate(async ({ gender,part }) => {
      // @ts-expect-error browser module
      const converter = await import('/tools/fab-armor/lowpoly-convert.js');
      return converter.convert(gender,part);
    },{gender,part});
    const id = `fab_${gender.toLowerCase()}_mage_${slots[part]}`;
    result.report.source = { author:'Polytope Studio',pack:'Lowpoly Medieval Modular Armors Free Pack',file:`SK_${gender}_Armor_05_C_${part}.fbx`,sha256:createHash('sha256').update(await readFile(`.asset-cache/fab-armor/lowpoly/SK_${gender}_Armor_05_C_${part}.fbx`)).digest('hex') };
    await writeFile(`.asset-cache/fab-armor/lowpoly/${id}.glb`,Buffer.from(result.bytes));
    await writeFile(`test-results/fab-armor-lowpoly/${id}.json`,JSON.stringify(result.report,null,2));
    const min = result.report.bounds.min, max = result.report.bounds.max;
    assets.push({id,file:`models/character/fab-armor/${id}.glb`,pack:'fab-lowpoly-medieval-modular-armors',category:'character',is:'armor',tags:['armor','mage','craftable',gender.toLowerCase(),slots[part],'rigged'],bytes:result.bytes.length,sha256:createHash('sha256').update(Buffer.from(result.bytes)).digest('hex'),size:{x:max[0]-min[0],y:max[1]-min[1],z:max[2]-min[2]},base:{x:min[0],y:min[1],z:min[2]},animations:[],materials:['fab_cloth','fab_leather','fab_trim']});
    files[id]=`${id}.glb`;
    console.log(JSON.stringify({id,bytes:result.bytes.length,counts:result.report.counts,bounds:result.report.bounds}));
  }
  await writeFile('.asset-cache/fab-armor/lowpoly/candidates.json',JSON.stringify({pack:{id:'fab-lowpoly-medieval-modular-armors',name:'Lowpoly Medieval Modular Armors Free Pack',author:'Polytope Studio',source:'Epic Games Launcher VaultCache/LowpolyM1da6d6f97a10V1',license:'Fab Standard License (user supplied)'},assets,files},null,2));
} finally {await browser.close();await server.close();}
