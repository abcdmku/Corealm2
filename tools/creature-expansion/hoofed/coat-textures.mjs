import * as THREE from 'three';

/** Small authored tile: curved hair ridges, broken tips and fine skin grain.
 * DataTextures keep source generation deterministic in both Node and Chromium.
 */
export function coatTextures(id){
  const size=256,height=new Float32Array(size*size),normal=new Uint8Array(size*size*4),rough=new Uint8Array(size*size*4),albedo=new Uint8Array(size*size*4);
  const wool=id==='cairn_bighorn',coarse=id==='marsh_moose',skinCoat=id==='bracken_tapir';
  const hash=(x,y)=>{const v=Math.sin(x*127.1+y*311.7)*43758.5453123;return v-Math.floor(v);};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const a=x/size*Math.PI*2,b=y/size*Math.PI*2;
    const ridges=Math.sin(a*24+.24*Math.sin(b*3)+.12*Math.sin(b*7));
    const broken=.58+.42*Math.sin(b*5+a*.0)**2;
    height[y*size+x]=skinCoat?.035*Math.sin(a*19+b*7)*Math.sin(b*23-a*3):wool?.40*Math.sin(a*13+1.4*Math.sin(b*11))*.5+.20*Math.sin(b*17+a*7):ridges*broken*.24+(coarse?.14:.065)*Math.sin(a*47+.6*Math.sin(b*2));
    height[y*size+x]+=(hash(x,y)-.5)*.075;
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,dx=height[y*size+(x+1)%size]-height[y*size+(x+size-1)%size],dy=height[((y+1)%size)*size+x]-height[((y+size-1)%size)*size+x];
    const n=new THREE.Vector3(-dx*1.8,-dy*1.8,1).normalize();normal[i]=Math.round((n.x*.5+.5)*255);normal[i+1]=Math.round((n.y*.5+.5)*255);normal[i+2]=Math.round((n.z*.5+.5)*255);normal[i+3]=255;
    const noseV=id==='marchwild_horse'?1.735/2.3:id==='cairn_bighorn'?1.33/2.3:id==='marsh_moose'?1.687/2.5:.96/2.3;
    const skin=Math.exp(-(((x/size-.5)/.047)**2+((y/size-noseV)/.080)**2)*1.2);
    const value=Math.round(246-61*skin+(hash(x,y)-.5)*4);rough[i]=value;rough[i+1]=value;rough[i+2]=value;rough[i+3]=255;
    const hairShade=Math.round(skinCoat?246+hash(x,y)*8:231+hash(x,Math.floor(y/4))*13+hash(x,y)*9);
    albedo[i]=hairShade;albedo[i+1]=hairShade;albedo[i+2]=hairShade;albedo[i+3]=255;
  }
  const create=(data,name)=>{const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);t.name=name;t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.RepeatWrapping;t.repeat.set(wool?12:coarse?16:22,wool?12:coarse?16:22);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;};
  const normalMap=create(normal,`${id}_short_coat_normal`),roughnessMap=create(rough,`${id}_coat_roughness`);normalMap.repeat.set(wool?10:coarse?12:14,wool?10:coarse?12:16);roughnessMap.repeat.set(1,1);
  const colorMap=create(albedo,`${id}_coat_albedo_grain`);colorMap.colorSpace=THREE.SRGBColorSpace;colorMap.repeat.copy(normalMap.repeat);
  return {normal:normalMap,roughness:roughnessMap,color:colorMap};
}
