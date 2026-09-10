import * as THREE from "three";
import { elementalFlowTexture, flowSampling } from "./elementalFlowTexture.js";
import { elementalRefractionFragment, refractionUniforms, registerElementalRefraction } from "./elementalRefraction.js";

type CurrentShape = "crescent" | "spiral" | "jet" | "helix";
interface CurrentProfile { turns?: number; width?: number; foot?: number; drift?: number; }

/** Sculpted air currents: 384 triangles per strip, with scene distortion and eroded luminous edges. */
export class AirCurrentSheets {
  private readonly batches = new Map<CurrentShape, {
    visible: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    pressure: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  }>();
  private readonly clock = { value: 0 };
  private readonly pose = new THREE.Object3D();
  private readonly unregister: (() => void)[] = [];
  dropped = 0;
  constructor(parent: THREE.Object3D, name = "elemental-air") {
    for (const [shape, id] of [["crescent", 0], ["spiral", 1], ["jet", 2], ["helix", 3]] as const) {
      const geometry = new THREE.PlaneGeometry(1, 1, 48, 4);
      const pos = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
      for (let i = 0; i < pos.count; i++) {
        const u = uv.getX(i), v = uv.getY(i), a = u * Math.PI * 2;
        pos.setXYZ(i, Math.cos(a) * (.8 + v * .2), u + Math.sin(a) * .1, Math.sin(a) * (.8 + v * .2));
      }
      geometry.computeVertexNormals();
      geometry.setAttribute("currentLife", new THREE.InstancedBufferAttribute(new Float32Array(64 * 4), 4).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("currentProfile", new THREE.InstancedBufferAttribute(new Float32Array(64 * 4), 4).setUsage(THREE.DynamicDrawUsage));
      const vertexShader = `attribute vec4 currentLife,currentProfile;uniform float time;
        varying vec2 vUv;varying vec4 vLife;varying vec3 vRefNormal,vRefView,vRefLocal;
        varying float vRefAlpha,vRefSeed;
        vec3 currentPoint(vec2 uv){
          float u=uv.x,v=uv.y,seed=currentLife.y,turns=currentProfile.x;
          float taper=pow(max(.0001,sin(u*3.14159265)),.65),w=currentProfile.y;
          float curl=sin(u*14.-time*5.+seed)*.022+sin(u*29.+time*3.+seed)*.009;
          vec3 p;
          #if CURRENT_SHAPE == 0
            float angle=(u-.5)*2.95,r=1.-v*w*taper+curl*taper;
            p=vec3(sin(angle)*r,cos(angle)*r-.48,sin(u*6.+seed)*.11*taper+sin(v*3.14)*.18);
          #elif CURRENT_SHAPE == 1
            float angle=u*6.2831853*turns+time*currentProfile.w;
            float r=1.-u*.88+(v-.5)*w*taper+curl;
            p=vec3(cos(angle)*r,u*.7+sin(u*9.+seed)*.12*taper,sin(angle)*r);
          #elif CURRENT_SHAPE == 2
            float angle=(v-.5)*w*5.+u*6.2831853*turns+time*currentProfile.w;
            float r=(.025+pow(max(0.,1.-u),1.35)*.70)*(1.+curl*4.);
            p=vec3(cos(angle)*r,sin(angle)*r,u*2.-1.);
          #else
            float angle=u*6.2831853*turns+time*currentProfile.w;
            float r=(currentProfile.z+(1.-currentProfile.z)*u)*(1.+curl*2.5);
            p=vec3(cos(angle)*r,u+(v-.5)*w*taper,sin(angle)*r);
            p.x+=sin(u*6.+time*1.1+seed)*u*.10;
            p.z+=cos(u*5.-time+seed)*u*.08;
          #endif
          return p;
        }
        void main(){
          vec3 p=currentPoint(uv),du=currentPoint(uv+vec2(.001,0.))-p,dv=currentPoint(uv+vec2(0.,.001))-p;
          vec3 n=normalize(cross(du,dv)+vec3(.00000001));mat3 m=mat3(instanceMatrix);
          n/=vec3(dot(m[0],m[0]),dot(m[1],m[1]),dot(m[2],m[2]));
          vec4 view=modelViewMatrix*instanceMatrix*vec4(p,1.);
          vRefNormal=normalize(normalMatrix*m*n);vRefView=-view.xyz;vRefLocal=p;
          vRefAlpha=currentLife.x*.88;vRefSeed=currentLife.y;
          vUv=uv;vLife=currentLife;gl_Position=projectionMatrix*view;
        }`;
      const emission = { value: 0 };
      const material = new THREE.ShaderMaterial({
        uniforms: { time: this.clock, flowTexture: { value: elementalFlowTexture() }, magicEmissionPass: emission },
        defines: { CURRENT_SHAPE: id }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        vertexShader,
        fragmentShader: `uniform float time,magicEmissionPass;${flowSampling}
          varying vec2 vUv;varying vec4 vLife;varying vec3 vRefNormal,vRefView;
          void main(){
            float u=vUv.x,v=vUv.y;
            float n=authoredFlow(vec2(u*2.4-time*.48,v*.55+u*.16),time*.6,vLife.y);
            float ends=smoothstep(0.,.08,u)*(1.-smoothstep(.86,1.,u));
            float edgePath=.12+sin(u*18.-time*5.+n*2.)*.038;
            float leading=exp(-pow((v-edgePath)/.075,2.));
            float tearing=smoothstep(.08,.58,n+v*.18);
            float body=sin(v*3.14159)*tearing*.62;
            float striae=pow(.5+.5*sin(v*46.+n*6.-u*18.-time*3.),12.)*tearing;
            float pulse=pow(.5+.5*sin(u*27.-time*9.+vLife.y),6.);
            float alpha=vLife.x*ends*(body+leading*(.12+tearing*.75)+striae*.16);
            if(alpha<.009)discard;
            vec3 tint=mix(vec3(.018,.085,.19),vec3(.065,.08,.23),vLife.z*.35);
            vec3 color=mix(tint,vec3(.78,.94,1.),leading*.90+striae*.20);
            // Concentrated silver-blue enchantment on the moving lip, clear air behind it.
            vec3 energy=vec3(.03,.17,.45)*striae*.55+mix(vec3(.48,1.25,2.4),vec3(.75,1.1,2.5),vLife.z*.35)*leading*(1.05+pulse*2.1);
            gl_FragColor=vec4(magicEmissionPass>.5?energy:color,alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      material.userData["magicEmissionPass"] = emission;
      const pressureMaterial = new THREE.ShaderMaterial({
        uniforms: refractionUniforms(this.clock, false, 22), defines: { CURRENT_SHAPE: id },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        vertexShader, fragmentShader: "varying vec2 vUv;" + elementalRefractionFragment.replace("float coverage=vRefAlpha", "float coverage=smoothstep(0.,.05,vUv.x)*(1.-smoothstep(.90,1.,vUv.x))*sin(vUv.y*3.14159)*vRefAlpha"),
      });
      const visible = new THREE.InstancedMesh(geometry, material, 64);
      const pressure = new THREE.InstancedMesh(geometry, pressureMaterial, 64);
      for (const mesh of [visible, pressure]) {
        mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); parent.add(mesh);
      }
      visible.name = `${name}-current-${shape}`; visible.renderOrder = 14;
      visible.userData["magicGlow"] = true;
      pressure.name = `${name}-current-refraction-${shape}`;
      this.unregister.push(registerElementalRefraction(pressure));
      this.batches.set(shape, { visible, pressure });
    }
  }
  get instances(): number { return [...this.batches.values()].reduce((n, b) => n + b.visible.count * 2, 0); }
  begin(seconds: number): void { this.clock.value = seconds; this.dropped = 0; for (const b of this.batches.values()) b.visible.count = b.pressure.count = 0; }
  put(shape: CurrentShape, x: number, y: number, z: number, sx: number, sy: number, sz: number,
    alpha: number, seed: number, yaw = 0, pitch = 0, roll = 0, profile: CurrentProfile = {}): void {
    if (alpha < .009 || Math.min(sx, sy, sz) < .008) return;
    const b = this.batches.get(shape)!, i = b.visible.count;
    if (i >= 64) { this.dropped++; return; }
    this.pose.position.set(x, y, z); this.pose.rotation.set(pitch, yaw, roll); this.pose.scale.set(sx, sy, sz); this.pose.updateMatrix();
    b.visible.setMatrixAt(i, this.pose.matrix); b.pressure.setMatrixAt(i, this.pose.matrix);
    (b.visible.geometry.getAttribute("currentLife") as THREE.InstancedBufferAttribute).setXYZW(i, alpha, seed, (seed % 5) / 4, 0);
    (b.visible.geometry.getAttribute("currentProfile") as THREE.InstancedBufferAttribute).setXYZW(i, profile.turns ?? 1.2, profile.width ?? .4, profile.foot ?? .68, profile.drift ?? 1.4);
    b.visible.count++; b.pressure.count++;
  }
  end(): void {
    for (const b of this.batches.values()) {
      for (const mesh of [b.visible, b.pressure]) { mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true; }
      b.visible.geometry.getAttribute("currentLife").needsUpdate = true;
      b.visible.geometry.getAttribute("currentProfile").needsUpdate = true;
    }
  }
  dispose(): void {
    for (const unregister of this.unregister) unregister();
    for (const b of this.batches.values()) { b.visible.removeFromParent(); b.pressure.removeFromParent(); b.visible.geometry.dispose(); b.visible.material.dispose(); b.pressure.material.dispose(); }
  }
}
