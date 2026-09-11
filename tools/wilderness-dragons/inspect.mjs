import {sourceLoader, readFbx, identities} from './source.mjs';
import {mkdir, writeFile} from 'node:fs/promises';
import * as THREE from 'three';
const loader = await sourceLoader(), reports = [];
for (const id of ['DragonTerrorBringer', 'DragonUsurper', 'DragonSoulEater']) {
  const root = await readFbx(loader, `test-results/wilderness-dragons/source/Assets/FourEvilDragonsPBR/Mesh/${id}Mesh.fbx`);
  root.updateMatrixWorld(true); const ids = identities(root), nodes = [];
  root.traverse(n => { if (n.isBone || n.isMesh) nodes.push({name:n.name,path:ids.byId.get(n.ID),position:n.getWorldPosition(new THREE.Vector3()).toArray(),mesh:!!n.isMesh,vertices:n.geometry?.attributes.position.count,skin:n.skeleton?.bones.length}); });
  const box = new THREE.Box3().setFromObject(root, true);
  reports.push({id,bounds:{min:box.min.toArray(),max:box.max.toArray()},nodes});
}
await mkdir('test-results/wilderness-dragons', {recursive:true});
await writeFile('test-results/wilderness-dragons/source-inspection.json', JSON.stringify(reports,null,2));
for(const r of reports) console.log(r.id,r.bounds, r.nodes.filter(n=>n.mesh),r.nodes.filter(n=>/Root|Head|Neck|Wing|Chest|Foot|feet|Tail/i.test(n.name)).map(n=>[n.name,n.position]));
