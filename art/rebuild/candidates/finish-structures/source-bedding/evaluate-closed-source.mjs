import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {Box3,Matrix4,Vector3} from 'three';
import sharp from 'sharp';
const id=process.argv[2]??'rock_09',root=`art/rebuild/candidates/finish-structures/source-bedding/closed-source/${id}`;
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
await mkdir(root,{recursive:true});
const metadataUrl=`https://api.polyhaven.com/files/${id}`,infoUrl=`https://api.polyhaven.com/info/${id}`;
const metadata=await(await fetch(metadataUrl)).json(),info=await(await fetch(infoUrl)).json(),record=metadata.gltf['1k'].gltf;
await writeFile(`${root}/files-api.json`,JSON.stringify(metadata,null,2));await writeFile(`${root}/info-api.json`,JSON.stringify(info,null,2));
const files=[];
async function download(file,entry){const response=await fetch(entry.url);if(!response.ok)throw Error(`${response.status}: ${entry.url}`);const data=Buffer.from(await response.arrayBuffer());if(hash(data,'md5')!==entry.md5)throw Error(`MD5 mismatch ${file}`);await mkdir(`${root}/${file}`.slice(0,`${root}/${file}`.lastIndexOf('/')),{recursive:true});await writeFile(`${root}/${file}`,data);files.push({file,url:entry.url,bytes:data.length,md5:entry.md5,sha256:hash(data)});return data;}
const gltf=JSON.parse((await download(`${id}.gltf`,record)).toString()),resources={};
for(const [file,entry]of Object.entries(record.include))if(file.endsWith('.bin'))resources[file]=await download(file,entry);
const clay=structuredClone(gltf);delete clay.images;delete clay.textures;delete clay.samplers;delete clay.materials;for(const mesh of clay.meshes)for(const primitive of mesh.primitives)delete primitive.material;
const doc=await new NodeIO().readJSON({json:clay,resources}),triangles=[],points=[],bounds=new Box3();
for(const node of doc.getRoot().listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){
 const matrix=new Matrix4().fromArray(node.getWorldMatrix()),position=p.getAttribute('POSITION'),index=p.getIndices(),start=points.length;
 for(let i=0;i<position.getCount();i++){const v=new Vector3().fromArray(position.getElement(i,[])).applyMatrix4(matrix);points.push(v);bounds.expandByPoint(v);}
 for(let i=0;i<(index?.getCount()??position.getCount());i+=3)triangles.push([0,1,2].map(j=>start+(index?index.getScalar(i+j):i+j)));
}
const tolerance=bounds.getSize(new Vector3()).length()*1e-7,welded=new Map(),remap=[],edges=new Map(),adjacency=new Map();
for(const point of points){const key=point.toArray().map(v=>Math.round(v/tolerance)).join(',');if(!welded.has(key))welded.set(key,welded.size);remap.push(welded.get(key));}
let degenerateTriangles=0,signedVolume=0;
for(const triangle of triangles){const ids=triangle.map(i=>remap[i]);if(new Set(ids).size<3)degenerateTriangles++;for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=`${Math.min(a,b)},${Math.max(a,b)}`;edges.set(key,(edges.get(key)??0)+1);if(!adjacency.has(a))adjacency.set(a,new Set());adjacency.get(a).add(b);}signedVolume+=points[triangle[0]].dot(points[triangle[1]].clone().cross(points[triangle[2]]))/6;}
const visited=new Set();let components=0;for(let i=0;i<welded.size;i++){if(visited.has(i))continue;components++;const queue=[i];while(queue.length){const j=queue.pop();if(visited.has(j))continue;visited.add(j);for(const k of adjacency.get(j)??[])if(!visited.has(k))queue.push(k);}}
for(const [view,yaw]of [['front',.4],['rear',Math.PI+.4],['side',Math.PI/2]]){
 const eye=new Vector3(Math.sin(yaw)*.95,.31,Math.cos(yaw)*.95).normalize(),right=new Vector3(Math.cos(yaw),0,-Math.sin(yaw)),up=new Vector3().crossVectors(eye,right),centre=bounds.getCenter(new Vector3());let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 const projected=triangles.map(indices=>{const t=indices.map(i=>points[i]);return {t,p:t.map(vertex=>{const w=vertex.clone().sub(centre),a=[w.dot(right),w.dot(up),w.dot(eye)];minX=Math.min(minX,a[0]);maxX=Math.max(maxX,a[0]);minY=Math.min(minY,a[1]);maxY=Math.max(maxY,a[1]);return a;})};});
 const scale=Math.min(710/(maxX-minX),625/(maxY-minY)),light=new Vector3(-.6,.7,.5).normalize();projected.sort((a,b)=>a.p.reduce((s,p)=>s+p[2],0)-b.p.reduce((s,p)=>s+p[2],0));
 const polygons=projected.map(({t,p})=>{const n=t[1].clone().sub(t[0]).cross(t[2].clone().sub(t[0])).normalize(),shade=Math.round(65+155*Math.max(0,n.dot(light)));return `<polygon points="${p.map(v=>`${(400+(v[0]-(minX+maxX)/2)*scale).toFixed(2)},${(390-(v[1]-(minY+maxY)/2)*scale).toFixed(2)}`).join(' ')}" fill="rgb(${shade},${shade},${shade})"/>`;}).join('');
 await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#25272a"/><text x="22" y="30" fill="white" font-family="sans-serif" font-size="18">${id} ${view} | untouched original geometry, CPU only</text>${polygons}</svg>`)).png().toFile(`${root}/${view}.png`);
}
const report={id,source:`https://polyhaven.com/a/${id}`,license:'CC0-1.0',licenseUrl:'https://polyhaven.com/license',metadataUrl,infoUrl,author:info.authors,files,geometry:{vertices:points.length,triangles:triangles.length,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:bounds.getSize(new Vector3()).toArray()},weldTolerance:tolerance,weldedVertices:welded.size,boundaryEdges:[...edges.values()].filter(n=>n===1).length,nonmanifoldEdges:[...edges.values()].filter(n=>n>2).length,degenerateTriangles,components,euler:welded.size-edges.size+triangles.length,signedVolume},mapsDownloaded:false,derivativeCreated:false,browserReviewed:false};
await writeFile(`${root}/inspection.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--maps')){for(const [file,entry]of Object.entries(record.include))if(!file.endsWith('.bin'))await download(file,entry);report.files=files;report.mapsDownloaded=true;await writeFile(`${root}/inspection.json`,JSON.stringify(report,null,2)+'\n');console.log('Original 1K maps staged.');}
