import path from 'node:path';
import sharp from 'sharp';

const clamp=x=>Math.max(0,Math.min(1,x));
const ellipse=(u,v,x,y,rx,ry)=>Math.exp(-(((u-x)/rx)**2)-((v-y)/ry)**2);
const mix=(a,b,t)=>a.map((x,i)=>x*(1-t)+b[i]*t);
function lattice(x,y){let n=(Math.imul(x,374761393)+Math.imul(y,668265263))|0;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
function smoothNoise(x,y){const a=Math.floor(x),b=Math.floor(y),u=x-a,w=y-b,tx=u*u*(3-2*u),ty=w*w*(3-2*w);return (lattice(a,b)*(1-tx)+lattice(a+1,b)*tx)*(1-ty)+(lattice(a,b+1)*(1-tx)+lattice(a+1,b+1)*tx)*ty;}
const noise=(u,v)=>(smoothNoise(u*61,v*61)*.58+smoothNoise(u*127,v*127)*.28+smoothNoise(u*259,v*259)*.14)*2-1;

/** Repaint the existing UV atlas in-place, keeping its muscle/crease luminance.
 * The face masks use verified source UV positions for eye sockets, lips and cheeks.
 */
export async function prepareCorpseTextures(skinPath,eyePath,clothPath,output){
  const skin=await sharp(skinPath).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const eye=await sharp(eyePath).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const cloth=await sharp(clothPath).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const result={};
  for(const id of ['zombie','plague_zombie','grave_ghoul']){
    const plague=id==='plague_zombie',ghoul=id==='grave_ghoul',palette=ghoul?[.65,.70,.72]:plague?[.66,.69,.50]:[.65,.71,.65];
    const pixels=Buffer.from(skin.data),width=skin.info.width,height=skin.info.height;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4,u=x/(width-1),v=y/(height-1),r=skin.data[i]/255,g=skin.data[i+1]/255,b=skin.data[i+2]/255,luma=r*.2126+g*.7152+b*.0722;
      let color=palette.map(value=>clamp(value+(luma-.48)*.68));
      // Soft bruising across the atlas plus fine mottling, not a global tint.
      const mottling=(noise(u,v)+1)*.5,bruise=clamp((Math.sin(u*47+Math.sin(v*29))+Math.sin(v*39-u*8)-.7)*.13);
      color=mix(color,ghoul?[.30,.34,.41]:plague?[.39,.40,.24]:[.36,.38,.38],bruise);
      color=color.map(c=>clamp(c+(mottling-.5)*.025));
      const socket=Math.max(ellipse(u,v,.137,.176,.026,.025),ellipse(u,v,.231,.176,.026,.025));
      color=mix(color,[.13,.15,.17],socket*.87);
      const cheek=Math.max(ellipse(u,v,.10,.235,.024,.042),ellipse(u,v,.269,.235,.024,.042));
      color=mix(color,[.31,.34,.34],cheek*.65);
      const mouth=ellipse(u,v,.182,.266,ghoul?.041:.031,.009),nose=ellipse(u,v,.184,.229,.012,.009);
      color=mix(color,[.13,.105,.115],Math.max(mouth*.9,nose*.65));
      // Irregular recessed cheek wound. Plague spreads across one temple; ghoul
      // has a wider dried jaw tear. No fresh red wash over healthy skin.
      const warp=1+noise(u*1.3,v*.9)*.28;
      const scar=ellipse(u,v,plague?.272:.097,plague?.195:.25,plague?.032:.019,(ghoul?.043:.027)*warp);
      const rim=clamp((scar-.17)*2.8),core=clamp((scar-.55)*3.0);
      color=mix(color,plague?[.34,.29,.15]:[.35,.22,.22],rim*.84);
      color=mix(color,[.105,.08,.085],core*.8);
      if(plague){const lesion=ellipse(u,v,.42,.56,.052,.065)+ellipse(u,v,.77,.70,.055,.042);color=mix(color,[.34,.32,.20],clamp(lesion)*.68);}
      for(let k=0;k<3;k++)pixels[i+k]=Math.round(clamp(color[k])*255);
    }
    const skinOut=path.join(output,id+'-corpse-albedo.png');await sharp(pixels,{raw:skin.info}).png().toFile(skinOut);
    const eyes=Buffer.from(eye.data);
    for(let y=0;y<eye.info.height;y++)for(let x=0;x<eye.info.width;x++){
      const i=(y*eye.info.width+x)*4,u=x/(eye.info.width-1),v=y/(eye.info.height-1),distance=Math.hypot(u-.5,v-.5),luma=(eye.data[i]+eye.data[i+1]+eye.data[i+2])/765;
      let color=[.46+luma*.27,.49+luma*.25,.47+luma*.26];
      if(distance<.13){const cloud=.59+.065*noise(u,v);color=plague?[cloud+.09,cloud+.06,cloud-.09]:[cloud,cloud+.025,cloud+.03];}
      if(distance<.025)color=mix(color,[.29,.32,.33],.38);
      for(let k=0;k<3;k++)eyes[i+k]=Math.round(clamp(color[k])*255);
    }
    const eyesOut=path.join(output,id+'-clouded-eyes.png');await sharp(eyes,{raw:eye.info}).png().toFile(eyesOut);
    const fabric=Buffer.from(cloth.data);
    for(let y=0;y<cloth.info.height;y++)for(let x=0;x<cloth.info.width;x++){
      const i=(y*cloth.info.width+x)*4,u=x/cloth.info.width,v=y/cloth.info.height,luma=(cloth.data[i]*.2126+cloth.data[i+1]*.7152+cloth.data[i+2]*.0722)/255;
      const stain=clamp((Math.sin(u*31+Math.sin(v*43))+Math.sin(v*21-u*4)-.5)*.2),n=noise(u,v)*.012;
      let color=[luma*.73+.085+n,luma*.73+.09+n,luma*.68+.085+n];
      color=mix(color,plague?[.16,.17,.095]:[.16,.14,.135],stain);
      for(let k=0;k<3;k++)fabric[i+k]=Math.round(clamp(color[k])*255);
    }
    const clothOut=path.join(output,id+'-burial-cloth.png');await sharp(fabric,{raw:cloth.info}).png().toFile(clothOut);
    result[id]={skin:skinOut,eyes:eyesOut,cloth:clothOut};
  }
  return result;
}
