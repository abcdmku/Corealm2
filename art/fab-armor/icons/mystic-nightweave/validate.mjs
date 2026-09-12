import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
const path='art/fab-armor/icons/mystic-nightweave/result.json';
const rows=JSON.parse(fs.readFileSync(path,'utf8'));
for(const row of rows){
  const bytes=fs.readFileSync(row.source);
  row.sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const meta=await sharp(bytes).metadata();
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let transparent=0,opaque=0;
  for(let i=3;i<data.length;i+=4){ if(data[i]===0) transparent++; if(data[i]===255) opaque++; }
  const corners=[data[3],data[(info.width-1)*4+3],data[((info.height-1)*info.width)*4+3],data[(info.width*info.height-1)*4+3]];
  row.alpha={width:meta.width,height:meta.height,hasAlpha:meta.hasAlpha,transparentPixels:transparent,opaquePixels:opaque,cornerAlpha:corners};
  if(!meta.hasAlpha || transparent<100 || corners.some(x=>x!==0)) throw new Error(row.id+' alpha failure');
  console.log(row.id+' '+JSON.stringify(row.alpha));
}
fs.writeFileSync(path,JSON.stringify(rows,null,2)+'\n');
