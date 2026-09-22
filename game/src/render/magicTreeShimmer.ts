import * as THREE from "three";
import type { Node, MeshStandardNodeMaterial, MeshPhysicalNodeMaterial } from "three/webgpu";
import { dot, exp, float, floor, fract, max, min, mix, mod, positionGeometry, pow, reference,
  sin, smoothstep, step, texture, uv, varying, vec2, vec3 } from "three/tsl";
import { cloneNodeMaterial, composeSurface } from "./nodeMaterials.js";
import { objectInstanceWorldOrigin } from "./objectTransformNodes.js";

/** Shared clock, no geometry displacement: rigid bark and foliage keep their normal collision. */
export function createMagicTreeShimmer(source: THREE.Material, time: { value: number }): THREE.Material {
  const standard = source as THREE.MeshStandardMaterial;
  const lit = standard.isMeshStandardMaterial
    || (source as MeshStandardNodeMaterial).isMeshStandardNodeMaterial
    || (source as MeshPhysicalNodeMaterial).isMeshPhysicalNodeMaterial;
  if (!source.userData.corealmMagicTree || !lit) return source;
  const material = cloneNodeMaterial(source);
  material.name = `${source.name}@magic-shimmer`;

  const clock = reference("value", "float", time);
  const phase = varying(dot(objectInstanceWorldOrigin().xz, vec2(0.173, 0.277)));
  const magicClock = clock.add(phase);
  const local = varying(positionGeometry);
  const treeUV = uv();
  let radiance: Node<"vec3"> = vec3(0);

  if (!/Leaves/i.test(source.name)) {
    // UV.y is swept branch arc length. Motes follow angled limbs from base to tip.
    for (let layer = 0; layer < 2; layer++) {
      const offset = layer * 0.137;
      const lane = floor(treeUV.x.add(offset).mul(5));
      const laneSeed = fract(sin(lane.mul(127.1).add(phase.mul(31.7)).add(layer * 87.3)).mul(43758.5453));
      const speed = laneSeed.mul(0.36).add(0.32);
      const flow = treeUV.y.sub(magicClock.mul(speed));
      const cell = floor(flow.div(1.8));
      const seed = fract(sin(lane.mul(91.7).add(cell.mul(43.3)).add(layer * 19.1)).mul(27453.271));
      const centreU = lane.add(0.25).add(seed.mul(0.5)).div(5).sub(offset)
        .add(sin(treeUV.y.mul(3.4).add(lane.mul(2.1))).mul(0.014));
      const du = treeUV.x.sub(centreU);
      const dy = mod(flow, 1.8).sub(seed.mul(0.8).add(0.4));
      const core = exp(du.mul(du).div(-0.00030).sub(dy.mul(dy).div(0.00075)));
      const halo = exp(du.mul(du).div(-0.0020).sub(dy.mul(dy).div(0.0060)));
      const tail = exp(du.mul(du).div(-0.00045)).mul(exp(min(dy, 0).mul(13))).mul(step(dy, 0));
      const alive = smoothstep(0.18, 0.38, seed);
      const moteColour = mix(vec3(0.10, 0.65, 0.90), vec3(0.55, 0.28, 1), laneSeed);
      radiance = radiance.add(vec3(0.80, 0.96, 1).mul(core).mul(4)
        .add(moteColour.mul(halo.mul(0.60).add(tail.mul(0.75)))).mul(alive));
    }
  } else {
    let leafLight: Node<"float"> = float(0.3);
    if (standard.map) {
      const sample = texture(standard.map);
      leafLight = dot(sample.rgb.div(max(sample.a, 0.001)), vec3(0.2126, 0.7152, 0.0722));
    }
    const wave = sin(magicClock.mul(1.6).add(local.y.mul(0.8))
      .add(local.x.mul(0.9)).add(local.z.mul(0.65))).mul(0.5).add(0.5);
    const veins = smoothstep(0.13, 0.38, leafLight);
    const scintillation = pow(sin(dot(local, vec3(14.1, 8.7, 19.3)).add(magicClock.mul(2.3))).mul(0.5).add(0.5), 24);
    const sheenColour = mix(vec3(0.08, 0.52, 0.67), vec3(0.55, 0.40, 0.90), wave);
    radiance = sheenColour.mul(pow(wave, 3).mul(0.16).add(0.025))
      .add(sheenColour.mul(0.30).mul(wave).add(vec3(0.65, 0.95, 1).mul(scintillation).mul(1.6)).mul(veins));
  }

  return composeSurface(material, { emissive: previous => previous.add(radiance) });
}
