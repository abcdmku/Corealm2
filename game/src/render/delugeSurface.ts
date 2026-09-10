import * as THREE from "three";
import type { Vec3 } from "../contracts.js";
import { FINALE } from "../content/elementalFinales.js";
import { refractionUniforms, registerElementalRefraction } from "./elementalRefraction.js";
import { flowSampling } from "./elementalFlowTexture.js";

const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const ease=(x:number)=>{const u=clamp(x);return u*u*(3-2*u);};
const crash=FINALE.deluge.contact+FINALE.deluge.rowGap*2;

// Direction, lift, outward speed, breadth, delay and sideways curl. The collision
// throws different masses of water, leaving air between their upper sheets.
const splashLobes=[
  [.14,9.2,4.8,2.55,0,.7], [.91,4.4,9.0,4.3,.020,-1.1],
  [1.86,7.6,3.6,2.9,.012,1.4], [2.48,3.1,11.2,4.9,.042,-.8],
  [3.32,6.8,5.6,2.3,.006,-1.2], [4.17,4.9,7.6,3.8,.032,.9],
  [5.03,3.6,10.1,4.5,.018,1.3], [5.73,7.3,4.4,2.5,.055,-.6],
] as const;

export function delugeSplashPoint(lobe:number,across:number,v:number,age:number):Vec3 {
  const [angle,height,speed,width,delay,twist]=splashLobes[lobe%splashLobes.length]!;
  const flight=Math.max(0,(age-crash)/1000-delay),rise=1-Math.exp(-flight*24);
  const lift=Math.max(0,height*rise-(5.7+speed*.35)*flight*flight);
  // Unequal helical currents wrap the turbulent collision. Their shared
  // circulation carries momentum from the inward surf into the rising spray.
  const taper=Math.pow(Math.max(0,Math.sin(v*Math.PI)),.65);
  const side=(across-.5)*width*.46*taper*rise;
  const turn=angle+v*(2.1+twist*.42)-flight*(1.8+speed*.08);
  const radial=(.55+v*(2.8+speed*flight*.55))*rise;
  const fold=Math.sin(across*Math.PI*1.8+v*4.2-flight*5+lobe)*.28*taper;
  const radius=radial+fold+side*.40;
  return [Math.cos(turn)*radius+Math.sin(v*5+flight*2+lobe)*v*.26,
    Math.max(.035,.035+v*lift*.85+side-v*v*flight*1.8),
    Math.sin(turn)*radius+Math.cos(v*4-flight*2+lobe)*v*.31];
}

function splashGeometry():THREE.BufferGeometry {
  const positions:number[]=[],uvs:number[]=[],lobes:number[]=[],indices:number[]=[];
  // Eight unjoined patches share the old 2,880-triangle budget.
  for(let lobe=0;lobe<8;lobe++){
    const offset=positions.length/3;
    for(let v=0;v<=30;v++)for(let u=0;u<=6;u++){
      positions.push(0,0,0);uvs.push(u/6,v/30);lobes.push(lobe);
    }
    for(let v=0;v<30;v++)for(let u=0;u<6;u++){
      const a=offset+v*7+u,b=a+7;indices.push(a,b,a+1,a+1,b,b+1);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  g.setAttribute('splashLobe',new THREE.Float32BufferAttribute(lobes,1));
  g.setIndex(indices);g.computeVertexNormals();return g;
}

// Undertow's broken, luminous currents carried onto actual curling liquid geometry.
// The ground remains visible between streams; there is no opaque circular pool.
const delugeFragment=`${flowSampling}
  uniform sampler2D sceneColor;uniform vec2 viewport;uniform float time,strength;
  varying vec3 vRefNormal,vRefView,vRefLocal;varying vec2 vWaterUv;
  varying float vRefAlpha,vCross;
  void main(){
    float u=vWaterUv.x,v=vWaterUv.y;
    vec2 flowUv=vec2(u*3.8+v*.32,v*.73-time*.63);
    float body=authoredFlow(flowUv,time*.36,23.);
    float detail=authoredFlow(flowUv*2.4+vec2(body*.28,time*.15),time*.5,6.);
    float gaps=authoredFlow(vec2(u*2.3-v*.55,v*.35),time*.15,11.);
    float stream=smoothstep(.06,.36,body*.8+detail*.2);
    float edgeFade=smoothstep(0.,.045,v)*(1.-smoothstep(.92,1.,v));
    float bulk=1.-smoothstep(.40,.92,v);
    // A continuous dense wave belly; erosion is concentrated in the breaking lip.
    float coverage=vRefAlpha*edgeFade*(.82+stream*.16)*mix(smoothstep(.045,.21,gaps),.96,bulk*.86);
    #if SPLASH == 1
      float tear=body*.52+gaps*.48;
      coverage*=smoothstep(0.,.10,vCross)*(1.-smoothstep(.90,1.,vCross));
      if(v>.48&&tear<.16+v*.12)discard;
      coverage*=mix(.98,smoothstep(.18,.37,tear),smoothstep(.42,.92,v));
    #endif
    if(coverage<.016)discard;
    vec3 n=normalize(vRefNormal);
    n=normalize(n+vec3(detail-body,body-.4,detail-.45)*.45);
    float facing=abs(dot(n,normalize(vRefView))),fresnel=pow(1.-facing,3.);
    vec2 uv=gl_FragCoord.xy/viewport;
    vec2 shift=(n.xy+vec2(body-.5,detail-.5)*1.4)*strength*coverage/viewport;
    vec3 scene=texture2D(sceneColor,clamp(uv+shift,vec2(.002),vec2(.998))).rgb;
    vec3 deep=mix(vec3(.018,.19,.21),vec3(.075,.40,.39),stream);
    float thickness=.55+bulk*.28+fresnel*.10;
    vec3 color=mix(scene*vec3(.67,.92,.96),deep,thickness);
    float foam=smoothstep(.22,.58,body)*smoothstep(.20,.60,detail);
    float crest=pow(max(0.,sin(v*3.14159)),.7);
    color=mix(color,vec3(.69,.89,.86),foam*crest*(.74+fresnel*.18));
    #if SPLASH == 1
      // Clearer flowing bellies and foam at the torn upper edge keep the
      // central collision liquid instead of covering it in a white fabric mask.
      color=mix(scene*vec3(.65,.90,.94),deep,.62+fresnel*.15);
      color=mix(color,vec3(.79,.94,.91),foam*smoothstep(.28,.88,v)*.80);
      // The compressed collision catches a brief hard sheen across the moving
      // folds. It stays on the liquid surface and never blooms onto the spray.
      float impact=exp(-pow((time-${((crash+90)/1000).toFixed(2)})/.17,2.));
      color+=vec3(.19,.42,.43)*impact*(.25+foam*.55+fresnel*.65);
    #endif
    float glint=pow(max(0.,dot(n,normalize(vec3(-.35,.8,.45)))),30.);
    color+=vec3(.39,.70,.69)*glint*.75;
    color+=vec3(.055,.25,.28)*pow(detail,3.)*crest;
    gl_FragColor=vec4(color,coverage);
  }`;

/** One connected surf front. Adjacent points share motion; there are no repeated wave sections. */
export function delugePoint(angle:number,u:number,age:number,splash=false):Vec3 {
  const t=age/1000;
  const swell=Math.sin(angle*2+.8)*.39+Math.sin(angle*3-1.7)*.24+Math.sin(angle*7+.3)*.08;
  if(splash){
    const section=((angle/(Math.PI*2)%1)+1)%1*8;
    return delugeSplashPoint(Math.floor(section),section%1,u,age);
  }
  const localAge=age+swell*170;
  const rise=ease((localAge-250)/1300),pull=Math.pow(clamp((localAge-1650)/(crash-1650)),1.35);
  const radius=10.2*(1-pull)+.65*pull+swell*.9*(1-pull);
  const curl=-Math.PI/2+u*(Math.PI*1.43+Math.sin(angle*3-t*1.1)*.23);
  const breaking=1-ease((age-crash)/220);
  const compression=Math.pow(pull,4.)*(1-ease((age-crash)/130));
  const h=(4.1+swell*1.9)*rise*(1-pull*.14+compression*.40)*breaking;
  const lip=(Math.sin(curl)+1)*.5;
  angle-=pull*pull*1.35+u*pull*.48;
  const r=radius-Math.cos(curl)*(1.65+pull*.75)+Math.sin(angle*5-t*2.3)*u*.14;
  return [Math.cos(angle)*r, .035+lip*h,
    Math.sin(angle)*r];
}

/** 2,880 triangles per connected liquid sheet, deformed without skeletal animation. */
export class DelugeSurface {
  readonly mesh:THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  height=0;
  radius=0;
  private readonly clock={value:0};
  private readonly opacity={value:0};
  private readonly unregister:()=>void;
  constructor(parent:THREE.Object3D,private readonly splash:boolean){
    const geometry=splash?splashGeometry():new THREE.PlaneGeometry(1,1,80,18);
    (geometry.getAttribute("position") as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    const material=new THREE.ShaderMaterial({
      uniforms:{...refractionUniforms(this.clock,true,17,splash?3:0),surfaceOpacity:this.opacity},
      defines:{SPLASH:splash?1:0},
      transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
      vertexShader:`uniform float surfaceOpacity;varying vec3 vRefNormal,vRefView,vRefLocal;varying vec2 vWaterUv;varying float vRefAlpha,vCross;
        #if SPLASH == 1
          attribute float splashLobe;
        #endif
        void main(){vec4 view=modelViewMatrix*vec4(position,1.);vRefView=-view.xyz;vRefNormal=normalMatrix*normal;
          vRefLocal=position;vWaterUv=uv;vCross=uv.x;
          #if SPLASH == 1
            vWaterUv.x=(uv.x+splashLobe)*.283;
          #endif
          vRefAlpha=surfaceOpacity;gl_Position=projectionMatrix*view;}`,
      fragmentShader:delugeFragment,
    });
    this.mesh=new THREE.Mesh(geometry,material);this.mesh.name=splash?"elemental-deluge-torn-splash":"elemental-deluge-continuous-surf";
    this.mesh.frustumCulled=false;this.mesh.visible=false;this.mesh.renderOrder=splash?10:9;
    this.unregister=registerElementalRefraction(this.mesh);parent.add(this.mesh);
  }
  hide(){this.mesh.visible=false;this.height=0;this.radius=0;}
  update(x:number,y:number,z:number,age:number,alpha:number){
    this.mesh.visible=alpha>.01;if(!this.mesh.visible)return;
    this.mesh.position.set(x,y,z);this.clock.value=age/1000;this.opacity.value=alpha;
    const positions=this.mesh.geometry.getAttribute("position"),uvs=this.mesh.geometry.getAttribute("uv");
    this.height=0;this.radius=0;
    for(let i=0;i<positions.count;i++){
      const p=this.splash?delugeSplashPoint(this.mesh.geometry.getAttribute('splashLobe').getX(i),uvs.getX(i),uvs.getY(i),age)
        :delugePoint(uvs.getX(i)*Math.PI*2,uvs.getY(i),age);
      positions.setXYZ(i,...p);
      this.height=Math.max(this.height,p[1]);this.radius=Math.max(this.radius,Math.hypot(p[0],p[2]));
    }
    positions.needsUpdate=true;this.mesh.geometry.computeVertexNormals();
  }
  dispose(){this.unregister();this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
