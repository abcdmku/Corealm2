import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
const dir='assets/art/tripo/imports/creatures/audit-user-rift-carapace';
const out='test-results/creature-audit/user-rift-carapace';
await mkdir(out,{recursive:true});
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(await readFile(dir+'/sources/rift-carapace-original.glb'));
const p=doc.getRoot().listMeshes()[0].listPrimitives()[0],v=p.getAttribute('POSITION').getArray(),idx=p.getIndices().getArray();
const views=[['front',0,1,2],['side',2,1,0],['top',0,2,1]];
for(const [name,xi,yi,di] of views){
 const tris=[];
 for(let i=0;i<idx.length;i+=3){const ids=[idx[i],idx[i+1],idx[i+2]],points=ids.map(j=>[v[j*3+xi],v[j*3+yi],v[j*3+di]]);tris.push({z:points.reduce((s,p)=>s+p[2],0)/3,points});}
 tris.sort((a,b)=>a.z-b.z);
 const coords=p=>`${Math.round(500+p[0]*800)},${Math.round(470-p[1]*800)}`;
 const polys=tris.map(t=>`<polygon points="${t.points.map(coords).join(' ')}" fill="hsl(${270+Math.round(t.z*20)},45%,${Math.round(30+t.z*22)}%)" stroke="#302a42" stroke-width="0.4"/>`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="#ddd"/>${polys}</svg>`;
 await writeFile(out+`/source-${name}.png`,await sharp(Buffer.from(svg)).png().toBuffer());
}
for(const t of doc.getRoot().listTextures()) await writeFile(out+'/source-map-'+t.getName().slice(-1)+'.'+(t.getMimeType()==='image/png'?'png':'jpg'),t.getImage());
