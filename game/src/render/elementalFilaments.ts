import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { abs, attribute, cross, dot, float, max, mix, modelNormalMatrix, normalGeometry, normalize, positionGeometry, positionView, pow, sin, uniform, varying, vec3, vec4 } from "three/tsl";

/** Thin 3D energy strands. Connected segments share strand coordinates so glow flows through joins. */
export class ElementalFilaments {
  readonly mesh: THREE.Mesh<
    THREE.InstancedBufferGeometry,
    MeshBasicNodeMaterial
  >;
  private readonly starts: THREE.InstancedBufferAttribute;
  private readonly ends: THREE.InstancedBufferAttribute;
  private readonly tints: THREE.InstancedBufferAttribute;
  private readonly flows: THREE.InstancedBufferAttribute;
  private readonly colour = new THREE.Color();
  private count = 0;
  private readonly clock = uniform(0);
  private energyGain = 1;
  dropped = 0;
  readonly capacity = 4096;
  constructor(parent: THREE.Object3D) {
    const base = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
      geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", base.getAttribute("position"));
    geometry.setAttribute("normal", base.getAttribute("normal"));
    geometry.setIndex(base.index);
    const createAttribute = () =>
      new THREE.InstancedBufferAttribute(
        new Float32Array(this.capacity * 4),
        4,
      ).setUsage(THREE.DynamicDrawUsage);
    this.starts = createAttribute();
    this.ends = createAttribute();
    this.tints = createAttribute();
    this.flows = createAttribute();
    geometry.setAttribute("strandStart", this.starts);
    geometry.setAttribute("strandEnd", this.ends);
    geometry.setAttribute("strandTint", this.tints);
    geometry.setAttribute("strandFlow", this.flows);
    geometry.instanceCount = 0;
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const start = attribute("strandStart","vec4" as const), end = attribute("strandEnd","vec4" as const), tint = attribute("strandTint","vec4" as const), flow = attribute("strandFlow","vec4" as const);
    const axis = normalize(end.xyz.sub(start.xyz));
    const reference = abs(axis.y).greaterThan(.95).select(vec3(1,0,0),vec3(0,1,0));
    const right=normalize(cross(axis,reference)),forward=cross(right,axis), t=positionGeometry.y.add(.5);
    const along=varying(mix(flow.x,flow.y,t)),seed=varying(flow.z);
    const taper=float(.18).add(pow(max(sin(along.mul(3.14159)),0),.35).mul(.82));
    material.positionNode=mix(start.xyz,end.xyz,t).add(right.mul(positionGeometry.x).add(forward.mul(positionGeometry.z)).mul(start.w).mul(taper));
    const normal=normalize(varying(modelNormalMatrix.mul(right.mul(normalGeometry.x).add(forward.mul(normalGeometry.z)))));
    const face=abs(dot(normal,normalize(positionView.negate())));
    const pulse=pow(max(sin(along.mul(18).sub(this.clock.mul(15)).add(seed)),0),12);
    const alpha=varying(end.w).mul(pow(face,.65));
    const color=varying(tint.rgb.mul(tint.a)).mul(float(2.5).add(face.mul(3)).add(pulse.mul(6)));
    material.fragmentNode=vec4(color,alpha);
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
    this.clock.value = seconds;
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
