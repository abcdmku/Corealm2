import * as THREE from "three";

/** All motes are three-dimensional meshes. No camera-facing cards or particle atlases. */
export class ElementalParticleCloud {
  readonly mesh: THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.ShaderMaterial
  >;
  private readonly centres: THREE.InstancedBufferAttribute;
  private readonly colours: THREE.InstancedBufferAttribute;
  private readonly shapes: THREE.InstancedBufferAttribute;
  private count = 0;
  private energyGain = 1;
  dropped = 0;
  private readonly colour = new THREE.Color();
  readonly capacity: number;
  private readonly sizeFactor: number;
  constructor(
    parent: THREE.Object3D,
    kind: "light" | "smoke" | "fragment",
    capacity: number,
  ) {
    this.capacity = capacity;
    this.sizeFactor = kind === "light" ? 0.24 : kind === "fragment" ? 0.65 : 1;
    const base = kind === "fragment" ? new THREE.TetrahedronGeometry(1) : new THREE.OctahedronGeometry(1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", base.getAttribute("position"));
    geometry.setAttribute("normal", base.getAttribute("normal"));
    if (base.index) geometry.setIndex(base.index);
    this.centres = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 4),
      4,
    ).setUsage(THREE.DynamicDrawUsage);
    this.colours = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 4),
      4,
    ).setUsage(THREE.DynamicDrawUsage);
    this.shapes = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 4),
      4,
    ).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("centreSize", this.centres);
    geometry.setAttribute("tintAlpha", this.colours);
    geometry.setAttribute("shape", this.shapes);
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      defines: {
        SMOKE: kind === "smoke" ? 1 : 0,
        FRAGMENT: kind === "fragment" ? 1 : 0,
      },
      transparent: kind !== "fragment",
      depthWrite: kind === "fragment",
      depthTest: true,
      blending:
        kind === "light" ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.FrontSide,
      vertexShader: `attribute vec4 centreSize;attribute vec4 tintAlpha;attribute vec4 shape;
      varying vec4 vTint;varying vec3 vNormal;varying vec3 vLocal;varying vec3 vView;varying float vSeed;
      void main(){
       float c=cos(shape.x),s=sin(shape.x);mat3 spin=mat3(c,0,-s,0,1,0,s,0,c);
       vec3 p=position*vec3(shape.y,shape.z,1.0);p=spin*p;
       vec4 view=modelViewMatrix*vec4(centreSize.xyz+p*centreSize.w,1.0);
       vNormal=normalize(normalMatrix*spin*(normal/vec3(shape.y,shape.z,1.0)));vView=-view.xyz;vLocal=position;vTint=tintAlpha;vSeed=shape.w;
       gl_Position=projectionMatrix*view;
      }`,
      fragmentShader: `uniform float time;varying vec4 vTint;varying vec3 vNormal;varying vec3 vLocal;varying vec3 vView;varying float vSeed;
      void main(){
       vec3 n=normalize(vNormal);float face=max(0.0,dot(n,normalize(vView)));float lit=.48+.52*max(0.0,dot(n,normalize(vec3(-.4,.8,.3))));
       float alpha=vTint.a;vec3 colour=vTint.rgb;
       #if SMOKE == 1
        float breakup=smoothstep(-.2,.7,sin(vLocal.x*9.0+vSeed)*sin(vLocal.y*8.0-time*.7)*sin(vLocal.z*11.0+vSeed*.3));
        alpha*=pow(face,3.0)*breakup*.32;colour*=lit;
       #elif FRAGMENT == 1
        colour*=lit;
       #else
        float core=pow(face,8.0);colour*=4.0+core*9.0;alpha*=pow(face,2.5);
       #endif
       if(alpha<.006)discard;
       gl_FragColor=vec4(colour,alpha);
       #include <tonemapping_fragment>
       #include <colorspace_fragment>
      }`,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = `elemental-3d-${kind}`;
    this.mesh.userData["magicGlow"] = kind === "light";
    this.mesh.userData["magicGlowOnly"] = kind === "light";
    this.mesh.renderOrder =
      kind === "fragment" ? 0 : kind === "smoke" ? 10 : 11;
    parent.add(this.mesh);
  }
  begin(seconds: number, energyGain = 1): void {
    this.energyGain = energyGain;
    this.count = 0;
    this.dropped = 0;
    this.mesh.material.uniforms["time"]!.value = seconds;
  }
  put(
    x: number,
    y: number,
    z: number,
    size: number,
    hex: number,
    alpha: number,
    seed: number,
    stretch = 1,
    energy = 1,
  ): void {
    if (size < 0.001 || alpha < 0.006) return;
    if (this.count >= this.capacity) {
      this.dropped++;
      return;
    }
    const i = this.count++;
    this.centres.setXYZW(i, x, y, z, size * this.sizeFactor);
    this.colour.setHex(hex).multiplyScalar(energy);
    if (this.energyGain !== 1) this.colour.multiplyScalar(this.energyGain);
    this.colours.setXYZW(i, this.colour.r, this.colour.g, this.colour.b, alpha);
    this.shapes.setXYZW(
      i,
      seed * 0.71,
      0.55 + Math.abs(Math.sin(seed * 3)) * 0.6,
      stretch,
      seed,
    );
  }
  get instances(): number {
    return this.count;
  }
  end(): void {
    this.mesh.visible = this.count > 0;
    this.mesh.geometry.instanceCount = this.count;
    for (const attr of [this.centres, this.colours, this.shapes]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * 4);
      attr.needsUpdate = true;
    }
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
