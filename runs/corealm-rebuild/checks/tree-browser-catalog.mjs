import {readFile,writeFile} from 'node:fs/promises';
const catalog=JSON.parse(await readFile('test-results/tree-refinement/candidate/catalogue.json','utf8'));
catalog.assets=catalog.assets.filter(asset=>/^corealm_(oak|pine)_/.test(asset.id));
catalog.files=Object.fromEntries(catalog.assets.map(asset=>[asset.id,`candidate/${asset.id}.glb`]));
await writeFile('test-results/tree-refinement/browser-catalog.json',JSON.stringify(catalog));
