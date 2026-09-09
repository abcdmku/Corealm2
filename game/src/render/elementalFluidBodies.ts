import * as THREE from "three";
import { elementalRefractionFragment, refractionUniforms, registerElementalRefraction } from "./elementalRefraction.js";

/** Closed, curling water volumes. Surface lighting and airborne spray are separate layers. */
export class ElementalFluidBodies {
  private readonly batches = new Map<"wave" | "jet" | "drop" | "pool", THREE.InstancedMesh>();
  private readonly unregister: (()=>void)[] = [];
  private readonly object = new THREE.Object3D();
  private readonly clock = { value: 0 };
  dropped=0;
  constructor(parent: THREE.Object3D) {
    const wave = new THREE.BufferGeometry();
    const vertices: number[] = [],
      indices: number[] = [];
    const columns = 40,
      rows = 16;
    for (let side = 0; side < 2; side++)
      for (let j = 0; j <= rows; j++)
        for (let i = 0; i <= columns; i++) {
          const x = (i / columns) * 2 - 1,
            u = j / rows;
          const a = -Math.PI / 2 + u * Math.PI * 1.35;
          const ripple =
            0.035 * Math.sin(x * 6 + u * 5) + 0.012 * Math.sin(x * 13 - u * 8);
          const thickness = (side ? 1 : -1) * (0.07 + (1 - u) * 0.08);
          vertices.push(
            x,
            ((Math.sin(a) + 1) * 0.5 +
              Math.max(0, Math.sin(u * Math.PI)) * ripple) *
              (1 - 0.08 * x * x + .045*Math.sin(x*7+1.2) + .025*Math.sin(x*13)),
            Math.cos(a) * 0.7 + thickness,
          );
        }
    const surface = (columns + 1) * (rows + 1);
    for (let side = 0; side < 2; side++)
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < columns; i++) {
          const a = side * surface + j * (columns + 1) + i,
            b = a + 1,
            c = a + columns + 1,
            d = c + 1;
          if (side) indices.push(a, c, b, b, c, d);
          else indices.push(a, b, c, b, d, c);
        }
    // Join the front and back surfaces around their perimeter.
    for (let j = 0; j < rows; j++)
      for (const i of [0, columns]) {
        const a = j * (columns + 1) + i,
          b = a + columns + 1;
        indices.push(a, a + surface, b, b, a + surface, b + surface);
      }
    for (let i = 0; i < columns; i++)
      for (const j of [0, rows]) {
        const a = j * (columns + 1) + i,
          b = a + 1;
        indices.push(a, b, a + surface, b, b + surface, a + surface);
      }
    wave.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    wave.setIndex(indices);
    wave.computeVertexNormals();
    const jet = new THREE.CylinderGeometry(0.55, 0.18, 1, 24, 12, true);
    jet.translate(0, 0.5, 0);
    const jetVertices = jet.getAttribute("position");
    for (let i = 0; i < jetVertices.count; i++) {
      const x = jetVertices.getX(i),
        u = jetVertices.getY(i),
        z = jetVertices.getZ(i),
        a = Math.atan2(z, x);
      const fold =
        1 + Math.sin(a * 5 + u * 8) * 0.16 + Math.sin(a * 11 - u * 13) * 0.08;
      // The column breaks at different heights; detached spray carries the outward fall.
      const radius = 0.12 + Math.pow(Math.max(0,Math.sin(u*Math.PI)),.55)*.31,
        height = u * (0.90 + Math.sin(a * 3 + 1.3) * 0.025 + Math.sin(a * 7) * 0.014);
      jetVertices.setXYZ(
        i,
        Math.cos(a) * radius * fold + Math.sin(u * 3) * 0.09,
        height,
        Math.sin(a) * radius * fold + Math.sin(u * 4) * 0.09,
      );
    }
    jet.computeVertexNormals();
    for (const [kind, geometry] of [
      ["wave", wave],
      ["jet", jet],
      ["drop", new THREE.SphereGeometry(1,8,6)],
      ["pool", new THREE.SphereGeometry(1,32,12)],
    ] as const) {
      geometry.setAttribute("fluidVariant",new THREE.InstancedBufferAttribute(new Float32Array((kind==="drop"?640:32)*2),2).setUsage(THREE.DynamicDrawUsage));
      const material = new THREE.ShaderMaterial({
        uniforms: refractionUniforms(this.clock,true,kind === "drop" ? 5 : 14,kind === "pool" ? 2 : kind === "wave" ? 1 : kind === "jet" ? 3 : 0),
        defines: { FLUID_JET: kind === "jet" ? 1 : 0, FLUID_DROP: kind === "drop" ? 1 : 0 },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
        vertexShader: `uniform float time;attribute vec2 fluidVariant;
          varying vec3 vRefNormal,vRefView,vRefLocal;varying float vRefAlpha,vRefSeed;
          void main(){
            float seed=instanceMatrix[3].x*.31+instanceMatrix[3].z*.17+fluidVariant.x*2.31;
            vec3 p=position,n=normal;
            #if FLUID_DROP == 0
              float phase=p.y*13.0-time*7.0+seed;
              float surge=sin(phase)*.025+sin(p.x*7.0+p.z*9.0+time*4.0+seed)*.018;
              p+=normal*surge;
              #if FLUID_JET == 1
                p.x+=sin(p.y*6.0-time*3.0+seed)*p.y*.10;
                p.z+=cos(p.y*7.0-time*2.3+seed)*p.y*.09;
                p.x+=fluidVariant.y*p.y*p.y*.22;
                p.xz*=1.+sin(p.y*6.+fluidVariant.x)*.13;
              #else
                p.y+=sin(p.x*4.0-time*4.1+seed)*.14*smoothstep(.1,.8,p.y);
                p.z+=sin(p.x*3.5+time*3.7+seed)*.20*smoothstep(.1,.8,p.y);
                p.y*=1.+sin(p.x*3.1+fluidVariant.x*1.7)*.17;
                p.z+=fluidVariant.y*p.x*p.x*.24;
              #endif
              n+=vec3(cos(phase)*.28,sin(phase*.7)*.08,sin(phase)*.24);
            #endif
            vec4 view=modelViewMatrix*instanceMatrix*vec4(p,1.0);
            mat3 m=mat3(instanceMatrix);n/=vec3(dot(m[0],m[0]),dot(m[1],m[1]),dot(m[2],m[2]));
            vRefNormal=normalize(normalMatrix*m*n);vRefView=-view.xyz;
            vRefLocal=vec3(p.x,position.y,p.z);vRefAlpha=.93;vRefSeed=seed;
            gl_Position=projectionMatrix*view;
          }`,
        fragmentShader: elementalRefractionFragment,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, kind === "drop" ? 640 : 32);
      this.unregister.push(registerElementalRefraction(mesh));
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.name = `elemental-fluid-${kind}`;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.renderOrder = 9;
      parent.add(mesh);
      this.batches.set(kind, mesh);
    }
  }
  begin(seconds: number): void {
    this.clock.value = seconds;
    this.dropped=0;
    for (const mesh of this.batches.values()) mesh.count = 0;
  }
  put(
    kind: "wave" | "jet" | "drop" | "pool",
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    yaw: number,
    pitch=0,
    variant=0,
    bend=0,
  ): void {
    const mesh = this.batches.get(kind)!;
    if(Math.min(sx,sy,sz)<.005)return;
    if(mesh.count>=mesh.instanceMatrix.count){this.dropped++;return;}
    this.object.position.set(x, y, z);
    this.object.rotation.set(pitch, yaw, 0);
    this.object.scale.set(sx, sy, sz);
    this.object.updateMatrix();
    mesh.setMatrixAt(mesh.count, this.object.matrix);
    (mesh.geometry.getAttribute("fluidVariant") as THREE.InstancedBufferAttribute).setXY(mesh.count++,variant,bend);
  }
  get instances(): number {
    return [...this.batches.values()].reduce((sum, m) => sum + m.count, 0);
  }
  end(): void {
    for (const mesh of this.batches.values()) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.getAttribute("fluidVariant").needsUpdate = true;
    }
  }
  dispose(): void {
    for (const unregister of this.unregister) unregister();
    for (const mesh of this.batches.values()) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
