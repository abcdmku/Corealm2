import * as THREE from "three";

let combustionNoise: THREE.Data3DTexture | undefined;
function fireNoise(): THREE.Data3DTexture {
  if (combustionNoise) return combustionNoise;
  // Seeded spatial fuel, sampled with hardware interpolation.
  // No flame silhouettes or sprite tiles are stamped into this field.
  const size = 64, data = new Uint8Array(size ** 3);
  let seed = 0x6d2b79f5;
  for (let i = 0; i < data.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    data[i] = seed >>> 24;
  }
  combustionNoise = new THREE.Data3DTexture(data, size, size, size);
  combustionNoise.format = THREE.RedFormat;
  combustionNoise.minFilter = combustionNoise.magFilter = THREE.LinearFilter;
  combustionNoise.wrapS = combustionNoise.wrapT = combustionNoise.wrapR = THREE.RepeatWrapping;
  combustionNoise.unpackAlignment = 1;
  combustionNoise.needsUpdate = true;
  return combustionNoise;
}

/** Twelve-triangle proxies; flowing density is evaluated on the GPU inside each 3D volume. */
export class ElementalAtmosphere {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly centres: THREE.InstancedBufferAttribute;
  private readonly shapes: THREE.InstancedBufferAttribute;
  private readonly floors: THREE.InstancedBufferAttribute;
  private readonly phases: THREE.InstancedBufferAttribute;
  private count = 0;
  dropped = 0;
  readonly capacity = 48;
  constructor(parent: THREE.Object3D, kind: "fire" | "wind" | "dust" | "smoke") {
    const base = new THREE.BoxGeometry(2, 2, 2), geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", base.getAttribute("position"));geometry.setIndex(base.index);
    this.centres = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity*4),4).setUsage(THREE.DynamicDrawUsage);
    this.shapes = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity*4),4).setUsage(THREE.DynamicDrawUsage);
    this.floors = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity),1).setUsage(THREE.DynamicDrawUsage);
    this.phases = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity),1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("volumeCentre",this.centres);geometry.setAttribute("volumeShape",this.shapes);geometry.setAttribute("volumeFloor",this.floors);geometry.setAttribute("volumePhase",this.phases);geometry.instanceCount=0;
    const material = new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,depthTest:true,side:THREE.FrontSide,
      defines:{ VOLUME_KIND:kind==="fire"?0:kind==="wind"?1:kind==="dust"?2:3,VOLUME_STEPS:kind==="fire"?96:18 },
      uniforms:{ time:{value:0},magicEmissionPass:{value:0},volumeNoise:{value:kind==="fire"?fireNoise():null} },
      vertexShader:`attribute vec4 volumeCentre,volumeShape;attribute float volumeFloor,volumePhase;
        varying vec3 vEye,vSurface,vCentre,vSize;varying float vAlpha,vSeed,vFloor,vPhase;
        void main(){
          vec3 worldCentre=(modelMatrix*vec4(volumeCentre.xyz,1.)).xyz;
          vec3 eye=cameraPosition-worldCentre;mat3 m=mat3(modelMatrix);
          vEye=vec3(dot(eye,m[0])/dot(m[0],m[0]),dot(eye,m[1])/dot(m[1],m[1]),dot(eye,m[2])/dot(m[2],m[2]))/volumeShape.xyz;
          vSurface=position;vCentre=volumeCentre.xyz;vSize=volumeShape.xyz;
          vAlpha=volumeCentre.w;vSeed=volumeShape.w;vFloor=volumeFloor;vPhase=volumePhase;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(volumeCentre.xyz+position*volumeShape.xyz,1.);
        }`,
      fragmentShader:`uniform float time,magicEmissionPass;
        varying vec3 vEye,vSurface,vCentre,vSize;varying float vAlpha,vSeed,vFloor,vPhase;
        #if VOLUME_KIND == 0
        uniform highp sampler3D volumeNoise;
        float noise3(vec3 p){return texture(volumeNoise,(p+.5)/64.).r;}
        #else
        float hash(vec3 p){p=fract(p*.3183099+vec3(.13,.37,.71));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
        float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
        #endif
        void main(){
          vec3 ray=normalize(vSurface-vEye),inv=1./ray;
          vec3 a=(-1.-vEye)*inv,b=(1.-vEye)*inv,lo=min(a,b),hi=max(a,b);
          float enter=max(0.,max(lo.x,max(lo.y,lo.z))),leave=min(hi.x,min(hi.y,hi.z));
          if(leave<=enter)discard;
          float stride=(leave-enter)/float(VOLUME_STEPS),offset=fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715)))*.5+.25;
          vec4 sum=vec4(0.);
          for(int i=0;i<VOLUME_STEPS;i++){
            #if VOLUME_KIND == 0
              vec3 jitter=fract(vec3(gl_FragCoord.xyx)*.1031+float(i)*.123);
              jitter+=dot(jitter,jitter.yzx+33.33);
              offset=fract((jitter.x+jitter.y)*jitter.z);
            #endif
            vec3 p=vEye+ray*(enter+(float(i)+offset)*stride);
            if(vCentre.y+p.y*vSize.y<vFloor)continue;
            vec3 flow=p*vec3(3.8,2.4,3.8)+vec3(vSeed,-time*1.8,time*.24);
            float n=noise3(flow+noise3(flow*.65)*1.9)*.7+noise3(flow*2.07)*.3;
            float density,fireHeat=1.;vec3 color;
            #if VOLUME_KIND == 0
              // Advected 3D combustion. The shape and temperature come from different
              // spatial fields; no image is projected repeatedly through the gas.
              vec3 world=vCentre+p*vSize;
              vec3 fuel=world*1.35+vec3(vSeed*.173,-time*2.8,vSeed*.271);
              if(vPhase>=0.){
                vec2 radial=world.xz-vCentre.xz;
                fuel.xz-=radial/max(.1,length(radial))*(1.-exp(-vPhase*5.))*2.4;
              }
              vec3 drift=vec3(noise3(fuel*.38),noise3(fuel*.38+17.3),noise3(fuel*.38+41.7))-.5;
              fuel+=drift*2.6;
              float billow=noise3(fuel*.78),detail=noise3(fuel*2.13+drift*.7),tear=noise3(fuel*4.71);
              float envelope=1.-length(p*vec3(.92,1.,.96));
              float cooling=0.;
              if(vPhase>=0.){
                float spread=1.-exp(-vPhase*10.5);
                float radius=.75+spread*8.3,height=1.0+spread*3.8+vPhase*.85;
                vec3 q=vec3((world.x-vCentre.x-drift.x*1.5)/radius,
                  (world.y-vFloor-.12)/height,(world.z-vCentre.z-drift.z*1.7)/(radius*.86));
                q.x+=q.y*q.y*(.10+drift.z*.22);q.z-=q.y*q.y*.18;
                envelope=1.-length(q);
                cooling=smoothstep(.45,2.55,vPhase)*.65;
              }
              float edge=envelope+(billow-.5)*.95+(detail-.5)*.28;
              float turbulence=billow*.55+detail*.30+tear*.15;
              float border=1.-smoothstep(.80,1.,max(abs(p.x),max(abs(p.y),abs(p.z))));
              density=smoothstep(-.16,.26,edge)*smoothstep(.25,.55,turbulence)*border;
              if(vPhase>=0.){
                // Low-frequency gaps cut through the explosion instead of
                // filling its entire footprint with opaque burning gas.
                float openings=noise3(fuel*.27+vec3(4.,3.,12.));
                density*=smoothstep(.34,.65,openings);
              }
              fireHeat=clamp(smoothstep(.45,.74,turbulence+max(0.,envelope)*.035)-cooling,0.,1.);
              vec3 soot=mix(vec3(.013,.005,.008),vec3(.085,.027,.012),billow);
              // Most fuel stays red or becomes soot. Only small, hot combustion
              // regions reach orange/gold; they cannot bleach the whole blast.
              vec3 flame=mix(vec3(.24,.002,.001),vec3(1.35,.075,.002),fireHeat);
              flame=mix(flame,vec3(2.4,.55,.025),smoothstep(.70,.96,fireHeat));
              color=magicEmissionPass>.5?flame*fireHeat*.60:mix(soot,flame,smoothstep(.16,.68,fireHeat));
            #elif VOLUME_KIND == 1
              float u=p.y*.5+.5,angle=atan(p.z,p.x),radius=.08+.77*pow(u,.8);
              float coil=.5+.5*sin(angle*3.-u*34.+time*5.+n*3.5);
              float shell=exp(-abs(length(p.xz)-radius)*17.);
              density=shell*smoothstep(.23,.75,n*.58+coil*.42)*1.25*smoothstep(0.,.08,u);
              color=mix(vec3(.08,.11,.16),vec3(.30,.34,.38),n)*(.7+coil*.3);
            #elif VOLUME_KIND == 3
              density=smoothstep(.01,.48,1.-length(p)*1.2+n*.28-.1);
              color=mix(vec3(.008,.006,.008),vec3(.075,.044,.038),n*.7+max(0.,p.y)*.15);
            #else
              density=smoothstep(.03,.65,1.-length(p)+n*.65-.3);
              color=mix(vec3(.19,.17,.14),vec3(.53,.49,.40),n)*(.7+max(0.,p.y)*.3);
            #endif
            #if VOLUME_KIND == 0
              float opacity=(1.-exp(-density*stride*length(ray*vSize)*(vPhase>=0.?.60:1.4)))*vAlpha;
            #elif VOLUME_KIND == 3
              float opacity=(1.-exp(-density*stride*1.25))*vAlpha;
            #else
              float opacity=(1.-exp(-density*stride*3.8))*vAlpha;
            #endif
            #if VOLUME_KIND == 0
              if(magicEmissionPass>.5)opacity*=smoothstep(.15,.6,fireHeat);
            #endif
            sum.rgb+=(1.-sum.a)*opacity*color;sum.a+=(1.-sum.a)*opacity;
            if(sum.a>.98)break;
          }
          if(sum.a<.008)discard;
          gl_FragColor=vec4(sum.rgb/max(sum.a,.001),sum.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.name=`elemental-atmosphere-${kind}`;
    this.mesh.frustumCulled=false;this.mesh.visible=false;this.mesh.renderOrder=kind==="fire"?10:kind==="smoke"?14:9;
    this.mesh.userData["magicGlow"]=kind==="fire";this.mesh.userData["magicGlowOnly"]=false;
    if(kind==="fire")material.userData["magicEmissionPass"]=material.uniforms["magicEmissionPass"];
    parent.add(this.mesh);
  }
  begin(seconds:number):void{this.count=0;this.dropped=0;this.mesh.visible=false;this.mesh.material.uniforms["time"]!.value=seconds;}
  put(x:number,y:number,z:number,sx:number,sy:number,sz:number,alpha:number,seed:number,floor=-1000,phase=-1):void{
    if(alpha<.008||Math.min(sx,sy,sz)<.005)return;
    if(this.count>=this.capacity){this.dropped++;return;}
    this.centres.setXYZW(this.count,x,y,z,alpha);this.shapes.setXYZW(this.count,sx,sy,sz,seed);this.floors.setX(this.count,floor);this.phases.setX(this.count++,phase);
  }
  get instances():number{return this.count;}
  end():void{this.mesh.visible=this.count>0;this.mesh.geometry.instanceCount=this.count;for(const a of [this.centres,this.shapes,this.floors,this.phases]){a.clearUpdateRanges();a.addUpdateRange(0,this.count*a.itemSize);a.needsUpdate=true;}}
  dispose():void{this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
