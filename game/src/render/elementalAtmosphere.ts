import * as THREE from "three";

/** Twelve-triangle proxies; flowing density is evaluated on the GPU inside each 3D volume. */
export class ElementalAtmosphere {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly centres: THREE.InstancedBufferAttribute;
  private readonly shapes: THREE.InstancedBufferAttribute;
  private readonly floors: THREE.InstancedBufferAttribute;
  private count = 0;
  dropped = 0;
  readonly capacity = 48;
  constructor(parent: THREE.Object3D, kind: "fire" | "wind" | "dust") {
    const base = new THREE.BoxGeometry(2, 2, 2), geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", base.getAttribute("position"));geometry.setIndex(base.index);
    this.centres = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity*4),4).setUsage(THREE.DynamicDrawUsage);
    this.shapes = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity*4),4).setUsage(THREE.DynamicDrawUsage);
    this.floors = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity),1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("volumeCentre",this.centres);geometry.setAttribute("volumeShape",this.shapes);geometry.setAttribute("volumeFloor",this.floors);geometry.instanceCount=0;
    const material = new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,depthTest:true,side:THREE.FrontSide,
      defines:{ VOLUME_KIND:kind==="fire"?0:kind==="wind"?1:2 },
      uniforms:{ time:{value:0} },
      vertexShader:`attribute vec4 volumeCentre,volumeShape;attribute float volumeFloor;
        varying vec3 vEye,vSurface,vCentre,vSize;varying float vAlpha,vSeed,vFloor;
        void main(){
          vec3 worldCentre=(modelMatrix*vec4(volumeCentre.xyz,1.)).xyz;
          vec3 eye=cameraPosition-worldCentre;mat3 m=mat3(modelMatrix);
          vEye=vec3(dot(eye,m[0])/dot(m[0],m[0]),dot(eye,m[1])/dot(m[1],m[1]),dot(eye,m[2])/dot(m[2],m[2]))/volumeShape.xyz;
          vSurface=position;vCentre=volumeCentre.xyz;vSize=volumeShape.xyz;
          vAlpha=volumeCentre.w;vSeed=volumeShape.w;vFloor=volumeFloor;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(volumeCentre.xyz+position*volumeShape.xyz,1.);
        }`,
      fragmentShader:`uniform float time;
        varying vec3 vEye,vSurface,vCentre,vSize;varying float vAlpha,vSeed,vFloor;
        float hash(vec3 p){p=fract(p*.3183099+vec3(.13,.37,.71));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
        float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
        void main(){
          vec3 ray=normalize(vSurface-vEye),inv=1./ray;
          vec3 a=(-1.-vEye)*inv,b=(1.-vEye)*inv,lo=min(a,b),hi=max(a,b);
          float enter=max(0.,max(lo.x,max(lo.y,lo.z))),leave=min(hi.x,min(hi.y,hi.z));
          if(leave<=enter)discard;
          float stride=(leave-enter)/18.,offset=fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715)))*.5+.25;
          vec4 sum=vec4(0.);
          for(int i=0;i<18;i++){
            vec3 p=vEye+ray*(enter+(float(i)+offset)*stride);
            if(vCentre.y+p.y*vSize.y<vFloor)continue;
            vec3 flow=p*vec3(3.8,2.4,3.8)+vec3(vSeed,-time*1.8,time*.24);
            float n=noise3(flow+noise3(flow*.65)*1.9)*.7+noise3(flow*2.07)*.3;
            float density;vec3 color;
            #if VOLUME_KIND == 0
              float interior=1.-length(p*vec3(.95,1.,.95));
              density=smoothstep(.05,.56,interior+n*.67-.22);
              float heat=smoothstep(.18,.8,interior*.55+n*.65);
              color=mix(vec3(.30,.014,.001),vec3(3.4,1.18,.12),heat*heat);
            #elif VOLUME_KIND == 1
              float u=p.y*.5+.5,angle=atan(p.z,p.x),radius=.08+.77*pow(u,.8);
              float coil=.5+.5*sin(angle*3.-u*34.+time*5.+n*3.5);
              float shell=exp(-abs(length(p.xz)-radius)*17.);
              density=shell*smoothstep(.23,.75,n*.58+coil*.42)*1.25*smoothstep(0.,.08,u);
              color=vec3(.64,.71,.74)*(.75+n*.4);
            #else
              density=smoothstep(.03,.65,1.-length(p)+n*.65-.3);
              color=mix(vec3(.19,.17,.14),vec3(.53,.49,.40),n)*(.7+max(0.,p.y)*.3);
            #endif
            float opacity=(1.-exp(-density*stride*3.8))*vAlpha;
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
    this.mesh.frustumCulled=false;this.mesh.visible=false;this.mesh.renderOrder=kind==="fire"?10:9;
    this.mesh.userData["magicGlow"]=kind==="fire";this.mesh.userData["magicGlowOnly"]=kind==="fire";
    parent.add(this.mesh);
  }
  begin(seconds:number):void{this.count=0;this.dropped=0;this.mesh.visible=false;this.mesh.material.uniforms["time"]!.value=seconds;}
  put(x:number,y:number,z:number,sx:number,sy:number,sz:number,alpha:number,seed:number,floor=-1000):void{
    if(alpha<.008||Math.min(sx,sy,sz)<.005)return;
    if(this.count>=this.capacity){this.dropped++;return;}
    this.centres.setXYZW(this.count,x,y,z,alpha);this.shapes.setXYZW(this.count,sx,sy,sz,seed);this.floors.setX(this.count++,floor);
  }
  get instances():number{return this.count;}
  end():void{this.mesh.visible=this.count>0;this.mesh.geometry.instanceCount=this.count;for(const a of [this.centres,this.shapes,this.floors]){a.clearUpdateRanges();a.addUpdateRange(0,this.count*a.itemSize);a.needsUpdate=true;}}
  dispose():void{this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
