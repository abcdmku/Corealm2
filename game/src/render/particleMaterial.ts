import * as THREE from 'three';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { Fn, cos, dot, float, fract, mat3, max, modelNormalMatrix, normalGeometry, normalize, positionGeometry, positionView, pow, screenCoordinate, sin, smoothstep, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { ParticleKind } from '../contracts.js';
import { clockUniform } from './elementalNodes.js';
import { acquireEffectMaterial } from './sharedEffectMaterial.js';

/** Frozen render contract. Centre.w is the authored size, before the kind's size factor.
 * Tint is linear RGB with energy already applied. Shape is yaw, x stretch, y stretch, seed. */
export interface ParticleMaterialInputs {
  centre: Node<'vec4'>;
  tint: Node<'vec4'>;
  shape: Node<'vec4'>;
}

export function particleGeometry(kind: ParticleKind): THREE.InstancedBufferGeometry {
  const base = kind === 'fragment' ? new THREE.TetrahedronGeometry(1) : new THREE.OctahedronGeometry(1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', base.getAttribute('position'));
  geometry.setAttribute('normal', base.getAttribute('normal'));
  if (base.index) geometry.setIndex(base.index);
  geometry.instanceCount = 0;
  base.dispose();
  return geometry;
}

/** Every recipe shares its graph across pools; inputs must resolve uniforms per object. */
export function acquireParticleMaterial(kind: ParticleKind, recipe: string,
  buildInputs: () => ParticleMaterialInputs): MeshBasicNodeMaterial {
  return acquireEffectMaterial(`elemental-particle:${kind}:${recipe}`, () => {
    const material = new MeshBasicNodeMaterial({
      transparent: kind !== 'fragment', depthWrite: kind === 'fragment', depthTest: true,
      blending: kind === 'light' ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.FrontSide,
    });
    const time = clockUniform(), { centre, tint, shape } = buildInputs();
    const sizeFactor = kind === 'light' ? .24 : kind === 'fragment' ? .65 : kind === 'droplet' ? .32 : 1;
    const c = cos(shape.x), s = sin(shape.x);
    let spin: Node<'mat3'> = mat3(c, 0, s.negate(), 0, 1, 0, s, 0, c);
    if (kind === 'fragment') {
      const ax = shape.w.mul(1.73).add(time.mul(fract(shape.w.mul(.37)).mul(3).add(1.1)));
      const az = shape.w.mul(2.41).sub(time.mul(fract(shape.w.mul(.63)).mul(2).add(.9)));
      spin = spin.mul(mat3(1,0,0,0,cos(ax),sin(ax),0,sin(ax).negate(),cos(ax)))
        .mul(mat3(cos(az),sin(az),0,sin(az).negate(),cos(az),0,0,0,1));
    }
    const stretch = vec3(shape.y, shape.z, 1);
    // Collapse dead candidates before rasterization; alpha still rejects their fragments.
    const alive = centre.w.greaterThanEqual(.001).and(tint.a.greaterThanEqual(.006));
    material.positionNode = centre.xyz.add(spin.mul(positionGeometry.mul(stretch)).mul(alive.select(centre.w.mul(sizeFactor), 0)));
    const normal = normalize(varying(modelNormalMatrix.mul(spin.mul((kind === 'droplet' ? positionGeometry : normalGeometry).div(stretch)))));
    const local = varying(positionGeometry), seed = varying(shape.w), vTint = varying(tint);
    material.fragmentNode = Fn((): Node<'vec4'> => {
      const face = max(dot(normal, normalize(positionView.negate())), 0);
      const lit = max(dot(normal, normalize(vec3(-.4,.8,.3))), 0).mul(.52).add(.48);
      const alpha = vTint.a.toVar(), colour = vTint.rgb.toVar();
      if (kind === 'smoke') {
        const breakup = smoothstep(-.2,.7,sin(local.x.mul(9).add(seed)).mul(sin(local.y.mul(8).sub(time.mul(.7)))).mul(sin(local.z.mul(11).add(seed.mul(.3)))));
        alpha.mulAssign(pow(face,3).mul(breakup).mul(.32)); colour.mulAssign(lit);
      } else if (kind === 'fragment') {
        fract(sin(dot(screenCoordinate.xy,vec2(12.9898,78.233))).mul(43758.5453)).greaterThan(alpha).discard(); colour.mulAssign(lit);
      } else if (kind === 'droplet') {
        const rim = pow(float(1).sub(face),3);
        const glint = pow(max(dot(normal,normalize(normalize(positionView.negate()).add(vec3(-.4,.8,.3)))),0),32);
        colour.assign(colour.mul(lit.mul(.40).add(.46)).add(vec3(.36,.48,.49).mul(rim)).add(vec3(.84,.92,.94).mul(glint)));
        alpha.mulAssign(face.mul(.24).add(.76));
      } else {
        colour.mulAssign(pow(face,8).mul(9).add(4)); alpha.mulAssign(pow(face,2.5));
      }
      alpha.lessThan(.006).discard(); return vec4(colour,alpha);
    })();
    return material;
  });
}
