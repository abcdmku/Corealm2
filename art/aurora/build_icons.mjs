import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const hash=b=>createHash('sha256').update(b).digest('hex');
const parts=['hood','robe','leggings','boots','wraps'],rows=[];
await mkdir('art/aurora/icons/256',{recursive:true});
await mkdir('game/public/assets/icons/items/48',{recursive:true});
for(const part of parts) {
  const itemId=`frostweave_${part}`,source=`art/aurora/icons/${itemId}.png`,bytes=await readFile(source);
  const meta=await sharp(bytes).metadata();assert(meta.hasAlpha,'Icons require true transparent renders');
  let iconSource=bytes;
  if(part==='wraps') {
    // Bring the two rendered gloves together for a readable inventory pair.
    // Their original wearable positions leave a large empty span in a square icon.
    const gloves=await Promise.all([0,1].map(async side=>sharp(await sharp(bytes)
      .extract({left:side*256,top:0,width:256,height:512}).png().toBuffer())
      .trim({background:{r:0,g:0,b:0,alpha:0},threshold:8})
      .resize(112,224,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer()));
    iconSource=await sharp({create:{width:240,height:224,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
      .composite(gloves.map((input,i)=>({input,left:i*128,top:0}))).png().toBuffer();
  }
  const outputs=[];
  for(const [size,padding,file] of [[256,8,`art/aurora/icons/256/${itemId}.png`],[48,2,`game/public/assets/icons/items/48/aurora_${itemId}.png`]]) {
    const data=await sharp(iconSource).trim({background:{r:0,g:0,b:0,alpha:0},threshold:8})
      .resize(size-padding*2,size-padding*2,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}})
      .extend({top:padding,bottom:padding,left:padding,right:padding,background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
    await writeFile(file,data);outputs.push({file,size,sha256:hash(data)});
    // The newly registered hood also needs a canonical master and fallback
    // derivative for generic catalog tools. Existing generated art is retained.
    if(part==='hood') {
      const canonical=size===256?`art/item-icons/256/${itemId}.png`:`game/public/assets/icons/items/48/${itemId}.png`;
      await mkdir(size===256?'art/item-icons/256':'game/public/assets/icons/items/48',{recursive:true});
      await writeFile(canonical,data);outputs.push({file:canonical,size,sha256:hash(data)});
    }
  }
  rows.push({itemId,source,sourceSha256:hash(bytes),method:'Actual frozen GLB rendered in Blender with transparent film, trimmed and padded; glove pair crops brought together for inventory readability; no imagegen icon substitution.',outputs});
}
const sheet=await sharp({create:{width:340,height:82,channels:4,background:'#15202b'}}).composite(await Promise.all(rows.map(async(row,i)=>({input:await sharp(await readFile(row.outputs.find(o=>o.size===48).file)).resize(48,48).png().toBuffer(),left:10+i*66,top:17})))).png().toBuffer();
await writeFile('art/aurora/icons/contact-sheet.png',sheet);
await writeFile('runs/aurora/icons.json',JSON.stringify({passed:true,rows},null,2)+'\n');
console.log(JSON.stringify({icons:5,passed:true}));
