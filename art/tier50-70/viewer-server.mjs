import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(directory,'../..');
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.glb':'model/gltf-binary'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost'),p=decodeURIComponent(url.pathname);let base,relative;
  if(p==='/'||p==='/viewer.html'){base=directory;relative='viewer.html';}
  else if(p==='/viewer.js'){base=directory;relative='viewer.js';}
  else if(p.startsWith('/vendor/')){base=path.join(repo,'node_modules/three');relative=p.slice(8);}
  else if(/^\/models\/(dragonhide|starhide|frostweave)\/(hood|robe|leggings|boots|wraps)\.glb$/.test(p)){
   const [,theme,part]=p.match(/^\/models\/(\w+)\/(\w+)\.glb$/);base=path.join(repo,`art/item-models/candidates/armor-${theme}-${theme==='frostweave'?'aurora':'reference'}/models/items`);relative=`${theme}_${part}.glb`;
  }else if(/^\/refs\/(dragonhide|starhide)_\w+\.png$/.test(p)){base=path.join(repo,'art/item-icons/generated');relative=p.slice(6);}
  else if(/^\/renders\/(dragonhide|starhide|frostweave)_[\w-]+\.png$/.test(p)){base=p.includes('/frostweave_')?path.join(repo,'art/aurora/renders'):path.join(directory,'renders');relative=p.slice(9);}
  else if(/^\/previews\/(dragonhide|starhide|frostweave)-studio\.png$/.test(p)){base=p.includes('/frostweave-')?path.join(repo,'art/aurora'):directory;relative=p.includes('/frostweave-')?'aurora-studio.png':p.slice(10);}
  else if(p==='/aurora-fabric.png'){base=path.join(repo,'art/aurora/textures');relative='cloth-color.png';}
  else if(p==='/aurora-reference.png'){base=path.join(repo,'art/aurora/references');relative='aurora-approved.png';}
  else{res.writeHead(404);res.end('Not found');return;}
  const file=path.resolve(base,relative);if(!file.startsWith(path.resolve(base)+path.sep))throw new Error('Invalid path');
  const info=await stat(file);if(!info.isFile())throw new Error('Not a file');
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache'});
  createReadStream(file).pipe(res);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(4186,'127.0.0.1',()=>console.log('Armor viewer: http://127.0.0.1:4186/'));
