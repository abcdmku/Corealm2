import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { abs, color, float, mix, positionGeometry, sin, smoothstep, time, uv, vec2, vec3 } from 'three/tsl';
import type { Enchantment } from '../content/itemUpgrades.js';
import { authoredFlow } from './elementalNodes.js';

// One segmented sheet serves every weapon. The socket supplies the weapon's animation.
const AURA_SHEET = new THREE.PlaneGeometry(1, 1, 4, 28).translate(0, .5, 0);

export function weaponAuraPalette(rank: number, enchantment?: Enchantment, itemId = ''): { edge: number; core: number } {
  // Model-backed and fallback equipment must resolve to the same stable weapon color.
  const identity = itemId.replace(/^corealm_item_/, '').replace(/__r\d+(?:__\w+)?$/, '');
  let hash = 0;
  for (const character of identity) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  const rankShift = [0, .16, .28, .4][Math.max(0, Math.min(3, rank - 7))]!;
  const elementalHue = enchantment === 'poison' ? .28 : enchantment === 'flame' ? .035 : enchantment === 'frost' ? .55 : undefined;
  const hue = elementalHue === undefined ? ((hash % 360) / 360 + rankShift) % 1
    : elementalHue + ((hash % 17) - 8) / 1000 + (rank % 2 ? -.025 : .025);
  const edge = new THREE.Color().setHSL(hue, 1, .5);
  const core = edge.clone().lerp(new THREE.Color(0xffffff), .38);
  return { edge: edge.getHex(), core: core.getHex() };
}

/** Flowing, torn-edged energy follows the blade instead of orbiting the grip. */
export function addWeaponUpgradeAura(object: THREE.Object3D, rank: number, enchantment?: Enchantment, itemId = ''): void {
  object.updateMatrixWorld(true);
  const inverse = object.matrixWorld.clone().invert(), bounds = new THREE.Box3();
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
  });
  if (bounds.isEmpty()) return;
  const size = bounds.getSize(new THREE.Vector3());
  const focusWeapon = /staff|wand|focus|orb/.test(itemId);
  const start = focusWeapon ? bounds.min.y + size.y * .64 : Math.max(.03, bounds.min.y + size.y * .23);
  const length = Math.max(.25, bounds.max.y - start);
  const strength = Math.max(.55, rank - 7);
  const palette = weaponAuraPalette(rank, enchantment, itemId);
  const width = Math.max(.14, size.x * .7) + .065 * strength;
  const layers = 3 + (rank >= 9 ? 2 : 1);
  for (let layer = 0; layer < layers; layer++) {
    const filament = layer >= 3, phase = layer * 2.399;
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    material.name = `weapon-aura-${rank}-${filament ? 'filament' : 'veil'}`;
    const p = positionGeometry, envelope = sin(p.y.mul(Math.PI)).max(0).pow(.6);
    const curl = sin(p.y.mul(12).sub(time.mul(3.4)).add(phase)).mul(.028 * strength).mul(envelope);
    const ripple = sin(p.y.mul(21).sub(time.mul(5)).add(phase)).mul(.18).add(1);
    // Preserve the wrapping filaments; only pull the broad +10 haze closer to the blade.
    const sheetWidth = filament ? width * .15 : width * (rank === 10 ? 1.6 : 2);
    material.positionNode = vec3(p.x.mul(sheetWidth).mul(envelope).mul(ripple).add(curl),
      p.y.mul(length + .035 * strength).add(start), sin(p.y.mul(9).sub(time.mul(2)).add(phase)).mul(.022 * strength).mul(envelope));
    const sample = uv();
    const flow = authoredFlow(sample.mul(vec2(filament ? .8 : 1.6, 2.5)), time.mul(1.9), float(phase));
    const crossFade = float(1).sub(abs(sample.x.mul(2).sub(1))).max(0);
    const ends = smoothstep(0, .12, sample.y).mul(float(1).sub(smoothstep(.72, 1, sample.y)));
    const tongues = smoothstep(.28, .76, flow.add(crossFade.mul(.23)));
    const hot = smoothstep(.65, .93, flow).mul(crossFade);
    const gain = 1.6 + strength * .9;
    material.colorNode = mix(color(palette.edge), color(palette.core), filament ? float(.85) : hot).mul(gain * (!filament && rank === 10 ? .75 : 1));
    material.opacityNode = crossFade.pow(filament ? 1.7 : .7).mul(ends).mul(tongues).mul(filament ? .8 : (.28 + strength * .055) * (rank === 10 ? .75 : 1));
    material.alphaTest = .006;
    material.userData['upgradeGlow'] = true;
    const sheet = new THREE.Mesh(AURA_SHEET, material);
    sheet.name = `upgrade-${filament ? 'filament' : 'aura'}`;
    sheet.rotation.y = layer * Math.PI / 3;
    sheet.frustumCulled = false;
    sheet.userData['magicGlowOnly'] = true;
    object.add(sheet);
  }
}
