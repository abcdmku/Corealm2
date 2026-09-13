import { chromium } from 'playwright';
import { startServer } from '../animals/serve.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
const out='test-results/red-worms/assets';
await mkdir(`${out}/models`,{recursive:true});
const server = await startServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.error(e));
  await page.goto(`${server.url}/tools/red-worms/convert.html`);
  await page.waitForFunction(() => typeof window.inspectWorm === 'function');
  const result=await page.evaluate(()=>window.convertWorm());
  const bytes=Buffer.from(result.base64,'base64');
  const doc=await new NodeIO().readBinary(bytes);
  const min=result.bounds.min,max=result.bounds.max;
  const archive='C:/Users/Borg/AppData/Roaming/Unity/Asset Store-5.x/SR Studios Kerala/3D ModelsCharacters/Worms FREE.unitypackage';
  const sha=b=>createHash('sha256').update(b).digest('hex');
  const pack={id:'sr-studios-worms-free',name:'Worms FREE',author:'SR Studios Kerala',
    source:'https://assetstore.unity.com/packages/3d/characters/worms-free-342926',
    license:'Standard Unity Asset Store EULA',assetStoreId:'342926',sourceArchive:'Worms FREE.unitypackage',archiveSha256:sha(await readFile(archive))};
  let triangles=0;for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives())triangles+=(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3;
  const asset={id:'creature_red_worm',file:'models/creature/creature_red_worm.glb',pack:pack.id,category:'character',is:'worm',tags:['creature','worm','source-rig'],
    bytes:bytes.length,sha256:sha(bytes),size:{x:max[0]-min[0],y:max[1]-min[1],z:max[2]-min[2]},base:{x:min[0],y:min[1],z:min[2]},triangles,
    animations:result.clips.map(c=>c.name),materials:doc.getRoot().listMaterials().map(m=>m.getName()),
    walkClipSeconds:2.4,runClipSeconds:1.5,attackSeconds:1,contactNormalized:.5,
    sourceProvenance:{archiveSha256:pack.archiveSha256,model:'Assets/Worms FREE/1-Small Worm/Meshes/Worm_HighPoly.fbx',
      texture:'Assets/Worms FREE/1-Small Worm/Textures/Base_Colors/Pink_Red.png',
      modifications:'Unity centimetres/globalScale 4; darker red albedo factor [0.52,0.26,0.15]; original Look as Idle; authored segment-wave locomotion and bend reactions on the source skeleton. Species scale 9.6.'}};
  await writeFile(`${out}/models/creature_red_worm.glb`,bytes);
  await writeFile(`${out}/candidates.json`,JSON.stringify({assets:[asset],packs:[pack],files:{creature_red_worm:'models/creature_red_worm.glb'}},null,2)+'\n');
  console.log(JSON.stringify({asset,clips:result.clips}));
} finally { await browser.close(); await server.close(); }


