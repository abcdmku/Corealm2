import * as THREE from "three";
import { isolateMagicEmission } from "./magicGlow.js";

const noiseGLSL = `
float hash3(vec3 p){p=fract(p*.3183099+vec3(.13,.37,.71));p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm3(vec3 p){return noise3(p)*.55+noise3(p*2.03)*.28+noise3(p*4.07)*.17;}
`;
export type VolumeShape = "sphere" | "tube" | "ring" | "funnel";

/** Dissolving spatial membranes around particle bodies. The noise is sampled in 3D. */
export class ElementalVolumes {
  private readonly batches = new Map<VolumeShape, THREE.InstancedMesh>();
  private readonly object = new THREE.Object3D();
  private readonly colour = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly direction = new THREE.Vector3();
  private energyGain = 1;
  constructor(parent: THREE.Object3D) {
    const geometries: Record<VolumeShape, THREE.BufferGeometry> = {
      sphere: new THREE.SphereGeometry(1, 28, 20),
      tube: new THREE.CylinderGeometry(1, 1, 1, 16, 6, true),
      ring: new THREE.TorusGeometry(1, 0.018, 8, 96),
      funnel: new THREE.CylinderGeometry(1, 0.12, 1, 40, 20, true),
    };
    for (const kind of Object.keys(geometries) as VolumeShape[]) {
      const geometry = geometries[kind];
      geometry.setAttribute(
        "envelope",
        new THREE.InstancedBufferAttribute(
          new Float32Array(160 * 2),
          2,
        ).setUsage(THREE.DynamicDrawUsage),
      );
      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { time: { value: 0 } },
        vertexShader: `attribute vec2 envelope;varying vec3 vLocal;varying vec3 vNormal;varying vec3 vView;varying vec3 vColour;varying vec2 vEnvelope;
        void main(){vLocal=position;vEnvelope=envelope;vColour=instanceColor;vec3 p=position;float wave=sin(p.y*13.0+envelope.y*2.0)+sin(p.x*17.0-p.z*11.0+envelope.y);p+=normal*wave*.025;vec4 view=modelViewMatrix*instanceMatrix*vec4(p,1);mat3 m=mat3(instanceMatrix);vec3 n=normal/vec3(dot(m[0],m[0]),dot(m[1],m[1]),dot(m[2],m[2]));vNormal=normalize(normalMatrix*m*n);vView=-view.xyz;gl_Position=projectionMatrix*view;}`,
        fragmentShader: `uniform float time;varying vec3 vLocal;varying vec3 vNormal;varying vec3 vView;varying vec3 vColour;varying vec2 vEnvelope;
        ${noiseGLSL}
        void main(){vec3 flow=vLocal*4.2+vec3(time*.45,-time*1.9,vEnvelope.y);float n=fbm3(flow+fbm3(flow*.7)*1.4);float filaments=pow(1.0-abs(n*2.0-1.0),12.0);float skin=smoothstep(.53,.69,n)*.4;float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),1.8);float alpha=(filaments*.55+skin+rim*filaments*.55)*vEnvelope.x;
        if(alpha<.012)discard;vec3 c=vColour*(2.0+filaments*5.0);gl_FragColor=vec4(c,alpha*.32);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, 160);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 12;
      mesh.name = `elemental-volume-${kind}`;
      mesh.userData["magicGlow"] = true;
      mesh.userData["magicGlowOnly"] = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(mesh);
      this.batches.set(kind, mesh);
    }
  }
  begin(seconds: number, energyGain = 1): void {
    this.energyGain = energyGain;
    for (const mesh of this.batches.values()) {
      mesh.count = 0;
      (mesh.material as THREE.ShaderMaterial).uniforms["time"]!.value = seconds;
    }
  }
  put(
    kind: VolumeShape,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    hex: number,
    alpha: number,
    seed: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): void {
    const mesh = this.batches.get(kind)!;
    if (mesh.count >= 160 || alpha < 0.01 || Math.min(sx, sy, sz) < 0.001)
      return;
    this.object.position.set(x, y, z);
    this.object.rotation.set(rx, ry, rz);
    this.object.scale.set(sx, sy, sz);
    this.write(mesh, hex, alpha, seed);
  }
  segment(
    a: readonly number[],
    b: readonly number[],
    width: number,
    hex: number,
    alpha: number,
    seed: number,
  ): void {
    const mesh = this.batches.get("tube")!;
    if (mesh.count >= 160 || alpha < 0.01) return;
    this.direction.set(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
    const length = this.direction.length();
    if (length < 0.002) return;
    this.object.position.set(
      (a[0]! + b[0]!) / 2,
      (a[1]! + b[1]!) / 2,
      (a[2]! + b[2]!) / 2,
    );
    this.object.quaternion.setFromUnitVectors(
      this.up,
      this.direction.divideScalar(length),
    );
    this.object.scale.set(width, length, width);
    this.write(mesh, hex, alpha, seed);
  }
  private write(
    mesh: THREE.InstancedMesh,
    hex: number,
    alpha: number,
    seed: number,
  ): void {
    this.object.updateMatrix();
    mesh.setMatrixAt(mesh.count, this.object.matrix);
    this.colour.setHex(hex);
    if (this.energyGain !== 1) this.colour.multiplyScalar(this.energyGain);
    mesh.setColorAt(mesh.count, this.colour);
    (
      mesh.geometry.getAttribute("envelope") as THREE.InstancedBufferAttribute
    ).setXY(mesh.count, alpha, seed);
    mesh.count++;
  }
  get instances(): number {
    return [...this.batches.values()].reduce((sum, m) => sum + m.count, 0);
  }
  end(): void {
    for (const mesh of this.batches.values()) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.geometry.getAttribute("envelope").needsUpdate = true;
    }
  }
  dispose(): void {
    for (const mesh of this.batches.values()) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}

/** Rounded fractured masses and five-sided ice needles, with full material lighting. */
export class ElementalSolids {
  readonly stone: THREE.InstancedMesh;
  readonly ice: THREE.InstancedMesh;
  private readonly object = new THREE.Object3D();
  private readonly colour = new THREE.Color();
  constructor(parent: THREE.Object3D) {
    const stone = new THREE.IcosahedronGeometry(1, 2),
      positions = stone.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i),
        r =
          0.88 +
          Math.sin(x * 8 + y * 5) * Math.cos(z * 9 - y * 7) * 0.1 +
          Math.sin(x * 21 - z * 14) * 0.035;
      positions.setXYZ(i, x * r, Math.max(-0.8, Math.min(0.74, y)) * r, z * r);
    }
    stone.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0xf0e6d4,
      roughness: 0.64,
      metalness: 0.08,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        `varying vec3 vStone;\n${shader.vertexShader}`.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvStone=position;",
        );
      shader.fragmentShader =
        `varying vec3 vStone;\n${noiseGLSL}\n${shader.fragmentShader}`.replace(
          "#include <color_fragment>",
          `#include <color_fragment>\nfloat grain=fbm3(vStone*22.0);float strata=noise3(vStone*vec3(6.0,25.0,6.0));diffuseColor.rgb*=.7+grain*.42+strata*.16;`,
        );
    };
    const ice = new THREE.CylinderGeometry(0.015, 0.21, 1, 5, 1);
    this.stone = this.batch(
      parent,
      stone,
      material,
      "elemental-fractured-stone",
    );
    this.ice = this.batch(
      parent,
      ice,
      new THREE.MeshPhysicalMaterial({
        color: 0x6c9497,
        roughness: 0.13,
        metalness: 0.16,
        emissive: 0x073f63,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.88,
        flatShading: true,
      }),
      "elemental-crystal-needles",
    );
    this.ice.userData["magicGlow"] = true;
    isolateMagicEmission(this.ice.material as THREE.Material);
  }
  private batch(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    name: string,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, 800);
    mesh.count = 0;
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(mesh);
    return mesh;
  }
  begin(): void {
    this.stone.count = this.ice.count = 0;
  }
  put(
    kind: "stone" | "ice",
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    hex: number,
    seed: number,
    tilt = 0,
  ): void {
    const mesh = this[kind];
    if (mesh.count >= 800 || Math.min(sx, sy, sz) < 0.001) return;
    this.object.position.set(x, y, z);
    this.object.rotation.set(
      Math.sin(seed) * tilt,
      seed,
      Math.cos(seed) * tilt,
    );
    this.object.scale.set(sx, sy, sz);
    this.object.updateMatrix();
    mesh.setMatrixAt(mesh.count, this.object.matrix);
    mesh.setColorAt(mesh.count, this.colour.setHex(hex));
    mesh.count++;
  }
  get instances(): number {
    return this.stone.count + this.ice.count;
  }
  end(): void {
    for (const mesh of [this.stone, this.ice]) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  dispose(): void {
    for (const mesh of [this.stone, this.ice]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
