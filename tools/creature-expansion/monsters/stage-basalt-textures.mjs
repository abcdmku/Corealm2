import fs from 'node:fs/promises';
import sharp from 'sharp';

const source='test-results/creature-expansion/sources/monsters/basalt/Assets/FreeDragons/Texture/DragonBoarPBR/';
const destination='test-results/creature-expansion/sources/monsters/basalt/derived/';
const metal=await sharp(`${source}Blue/Metallic.png`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const ao=await sharp(`${source}AO.png`).resize(metal.info.width,metal.info.height).ensureAlpha().raw().toBuffer();
const rgba=Buffer.alloc(metal.info.width*metal.info.height*4);
for(let i=0;i<rgba.length;i+=4){
  rgba[i]=ao[i]; rgba[i+1]=255-metal.data[i+3]; rgba[i+2]=metal.data[i]; rgba[i+3]=255;
}
await fs.mkdir(destination,{recursive:true});
await sharp(rgba,{raw:{width:metal.info.width,height:metal.info.height,channels:4}}).png().toFile(`${destination}blue-orm.png`);
console.log(`Preserved source AO R, 1-smoothness G and metallic B at ${metal.info.width}x${metal.info.height}.`);
