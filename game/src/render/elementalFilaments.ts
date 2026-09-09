import * as THREE from "three";

/** Thin 3D energy strands. Connected segments share strand coordinates so glow flows through joins. */
export class ElementalFilaments {
  readonly mesh: THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.ShaderMaterial
  >;
  private readonly starts: THREE.InstancedBufferAttribute;
  private readonly ends: THREE.InstancedBufferAttribute;
  private readonly tints: THREE.InstancedBufferAttribute;
  private readonly flows: THREE.InstancedBufferAttribute;
  private readonly colour = new THREE.Color();
  private count = 0;
  private energyGain = 1;
  dropped = 0;
  readonly capacity = 4096;
  constructor(parent: THREE.Object3D) {
    const base = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
      geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", base.getAttribute("position"));
    geometry.setAttribute("normal", base.getAttribute("normal"));
    geometry.setIndex(base.index);
    const attribute = () =>
      new THREE.InstancedBufferAttribute(
        new Float32Array(this.capacity * 4),
        4,
      ).setUsage(THREE.DynamicDrawUsage);
    this.starts = attribute();
    this.ends = attribute();
    this.tints = attribute();
    this.flows = attribute();
    geometry.setAttribute("strandStart", this.starts);
    geometry.setAttribute("strandEnd", this.ends);
    geometry.setAttribute("strandTint", this.tints);
    geometry.setAttribute("strandFlow", this.flows);
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 } },
      vertexShader: `attribute vec4 strandStart,strandEnd,strandTint,strandFlow;varying vec4 vTint;varying vec3 vNormal,vView;varying float vAlong,vSeed;
       void main(){vec3 axis=normalize(strandEnd.xyz-strandStart.xyz);vec3 ref=abs(axis.y)>.95?vec3(1,0,0):vec3(0,1,0);vec3 right=normalize(cross(axis,ref)),forward=cross(right,axis);float t=position.y+.5;vAlong=mix(strandFlow.x,strandFlow.y,t);vSeed=strandFlow.z;float taper=.18+.82*pow(max(0.,sin(vAlong*3.14159)),.35);vec3 offset=(right*position.x+forward*position.z)*strandStart.w*taper;vec3 p=mix(strandStart.xyz,strandEnd.xyz,t)+offset;vec4 view=modelViewMatrix*vec4(p,1);vView=-view.xyz;vNormal=normalize(normalMatrix*(right*normal.x+forward*normal.z));vTint=vec4(strandTint.rgb*strandTint.a,strandEnd.w);gl_Position=projectionMatrix*view;}`,
      fragmentShader: `uniform float time;varying vec4 vTint;varying vec3 vNormal,vView;varying float vAlong,vSeed;
       void main(){float face=abs(dot(normalize(vNormal),normalize(vView)));float pulse=pow(max(0.,sin(vAlong*18.-time*15.+vSeed)),12.);float alpha=vTint.a*pow(face,.65);vec3 colour=vTint.rgb*(2.5+face*3.+pulse*6.);gl_FragColor=vec4(colour,alpha);
       #include <tonemapping_fragment>
       #include <colorspace_fragment>
       }`,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.name = "elemental-energy-filaments";
    this.mesh.userData["magicGlow"] = true;
    this.mesh.userData["magicGlowOnly"] = true;
    this.mesh.renderOrder = 13;
    parent.add(this.mesh);
  }
  begin(seconds: number, energyGain = 1): void {
    this.energyGain = energyGain;
    this.count = 0;
    this.dropped = 0;
    this.mesh.material.uniforms["time"]!.value = seconds;
  }
  segment(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    width: number,
    hex: number,
    alpha: number,
    seed: number,
    u = 0,
    v = 1,
    energy = 1,
  ): void {
    if (
      alpha < 0.008 ||
      width < 0.0001 ||
      Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz) < 0.0001
    )
      return;
    if (this.count >= this.capacity) {
      this.dropped++;
      return;
    }
    const i = this.count++;
    this.starts.setXYZW(i, ax, ay, az, width * 2.6);
    this.ends.setXYZW(i, bx, by, bz, alpha);
    this.colour.setHex(hex);
    if (this.energyGain !== 1) this.colour.multiplyScalar(this.energyGain);
    this.tints.setXYZW(i, this.colour.r, this.colour.g, this.colour.b, energy);
    this.flows.setXYZW(i, u, v, seed, 0);
  }
  get instances(): number {
    return this.count;
  }
  end(): void {
    this.mesh.visible = this.count > 0;
    this.mesh.geometry.instanceCount = this.count;
    for (const attr of [this.starts, this.ends, this.tints, this.flows]) {
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
