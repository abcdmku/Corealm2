import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'derived');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const decode=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
const encode=x=>x<=.0031308?x*12.92:1.055*x**(1/2.4)-.055;
const lut=Array.from({length:256},(_,i)=>decode(i/255));
const recipe={source:'Blender2.73 original active MTex MAP_COL/MTEX_MUL slots',colorEvidence:'test-results/troll-mauler-source/source-colors.json',sourceCode:'https://raw.githubusercontent.com/blender/blender/v2.73/source/blender/render/intern/source/render_texture.c',equation:'runtime_sRGB = encode_sRGB(decode_sRGB(diffuse_RGB) * (1 - colfac * layer_alpha + colfac * layer_alpha * decode_sRGB(layer_RGB)))',alpha:'Preserve original diffuse alpha; layer alpha scales colfac, matching texture_rgb_blend.',sourceColorSpaces:'Both original diffuse and color-occlusion images are sRGB, isData=false, straight alpha. Original view Standard, exposure0, gamma1. Texture brightness/contrast1; same UV, identity offsets/scales.',normalChanges:'None',standardAO:false,outputs:[]};
for(const [materialName,colfac] of [['med',.5],['cloth',1]]){
 const base=path.join(dir,`${materialName}-base.png`),layer=path.join(dir,`${materialName}-occlusion.png`),normal=path.join(dir,`${materialName}-normal.png`);
 const inputs={base:hash(base),layer:hash(layer),normal:hash(normal)};
 const {data:b,info}=await sharp(base).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const {data:o,info:oi}=await sharp(layer).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==oi.width||info.height!==oi.height)throw Error('Original layers differ in resolution');
 const output=Buffer.alloc(b.length);let changed=0,minLayerAlpha=255,maxLayerAlpha=0;
 for(let i=0;i<b.length;i+=4){const f=colfac*o[i+3]/255;minLayerAlpha=Math.min(minLayerAlpha,o[i+3]);maxLayerAlpha=Math.max(maxLayerAlpha,o[i+3]);for(let c=0;c<3;c++){output[i+c]=Math.round(255*encode(lut[b[i+c]]*(1-f+f*lut[o[i+c]])));if(output[i+c]!==b[i+c])changed++;}output[i+3]=b[i+3];}
 const target=path.join(dir,`${materialName}-legacy-color.png`);
 await sharp(output,{raw:{width:info.width,height:info.height,channels:4}}).png().toFile(target);
 for(const [k,p] of [['base',base],['layer',layer],['normal',normal]])if(hash(p)!==inputs[k])throw Error('Original input changed');
 recipe.outputs.push({materialName,colfac,path:path.basename(target),sha256:hash(target),width:info.width,height:info.height,changedRgbChannels:changed,layerAlphaRange:[minLayerAlpha,maxLayerAlpha],originals:{baseColor:{path:path.basename(base),sha256:inputs.base},colorLayer:{path:path.basename(layer),sha256:inputs.layer},normal:{path:path.basename(normal),sha256:inputs.normal}}});
}
fs.writeFileSync(path.join(dir,'legacy-color-recipe.json'),JSON.stringify(recipe,null,2));console.log(JSON.stringify(recipe.outputs));
