/** Browser-only 3D renderer used by tools/generate-item-icons.ts. */
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { ItemId } from "../contracts.js";
import { AssetRegistry } from "./assets.js";
import {
  itemIconAppearance,
  type ItemIconAppearance,
  type ItemIconAssetPart,
  type ItemIconPresentationState,
  type ItemIconPrimitive,
  type ItemIconPrimitivePart,
} from "./itemIconAppearances.js";
import { applyGearAppearance } from "./equipmentVisuals.js";
import { awaitFabArmorTextures } from './fabArmor.js';
import { setFabMagicSampleTime } from './fabMagicSurface.js';
import { isProceduralGearAsset, registerProceduralGear } from "./proceduralGear.js";

interface ItemIconRendererApi {
  ready: boolean;
  render(itemId: ItemId, state?: ItemIconPresentationState): Promise<string>;
}

declare global {
  interface Window {
    __itemIconRenderer?: ItemIconRendererApi;
  }
}

const SIZE = 256;
const assets = new AssetRegistry();
registerProceduralGear(assets);
let renderer: THREE.WebGLRenderer;

const scene = new THREE.Scene();
const root = new THREE.Group();
root.name = "item-icon-root";
scene.add(root);

// One fixed look for the whole catalog. The object rotates only to correct authored axes.
const hemisphere = new THREE.HemisphereLight(0xfff1dc, 0x302821, 1.25);
scene.add(hemisphere);
const key = new THREE.DirectionalLight(0xffe3c2, 3);
key.position.set(-3, 5, 4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
key.shadow.camera.near = 0.1;
key.shadow.camera.far = 14;
scene.add(key);
const rim = new THREE.DirectionalLight(0xb9d1ff, 0.8);
rim.position.set(4, 2, -4);
scene.add(rim);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
const CAMERA_DIRECTION = new THREE.Vector3(1, 0.8165, 1).normalize();
camera.position.copy(CAMERA_DIRECTION).multiplyScalar(6);
camera.lookAt(0, 0, 0);

function material(colour: number, roughness = 0.62, metalness = 0.05): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: colour, roughness, metalness });
}

function luminousMaterial(colour: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: colour,
    emissive: colour,
    emissiveIntensity: intensity,
    roughness: 0.28,
    metalness: 0.04,
  });
}

function ownedMesh(geometry: THREE.BufferGeometry, source: THREE.Material): THREE.Mesh {
  geometry.userData["itemIconOwned"] = true;
  const mesh = new THREE.Mesh(geometry, source);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addBand(group: THREE.Group, y: number, colour: number): void {
  const band = ownedMesh(new THREE.CylinderGeometry(0.105, 0.105, 0.12, 12), material(colour, 0.38, 0.45));
  band.position.y = y;
  group.add(band);
}

function taperedStrand(points: readonly THREE.Vector3[], radius: number, surface: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3([...points]);
  const geometry = new THREE.TubeGeometry(curve, 20, radius, 8, false);
  const position = geometry.getAttribute("position");
  const centre = new THREE.Vector3();
  const value = new THREE.Vector3();
  for (let ring = 0; ring <= 20; ring += 1) {
    const t = ring / 20;
    curve.getPointAt(t, centre);
    const taper = Math.max(0.015, Math.pow(1 - t, 0.7));
    for (let side = 0; side <= 8; side += 1) {
      const index = ring * 9 + side;
      value.fromBufferAttribute(position, index).sub(centre).multiplyScalar(taper).add(centre);
      position.setXYZ(index, value.x, value.y, value.z);
    }
  }
  geometry.computeVertexNormals();
  return ownedMesh(geometry, surface);
}

function organicPlate(points: readonly (readonly [number, number])[], depth: number, surface: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => index === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 2,
  });
  return ownedMesh(geometry, surface);
}

export function buildItemIconPrimitive(part: ItemIconPrimitivePart): THREE.Group {
  const group = new THREE.Group();
  const variant = part.variant ?? 0;
  group.name = `item-icon-${part.primitive}-${variant}`;
  const primary = material(part.colour);
  const secondary = material(part.accent ?? part.colour, 0.4, 0.25);

  const builders: Record<ItemIconPrimitive, () => void> = {
    dagger: () => {
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(0, 1.12);
      bladeShape.lineTo(0.28, 0.32);
      bladeShape.lineTo(0.2, -0.36);
      bladeShape.lineTo(-0.2, -0.36);
      bladeShape.lineTo(-0.28, 0.32);
      bladeShape.closePath();
      const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
        depth: 0.12,
        bevelEnabled: true,
        bevelSegments: 1,
        bevelSize: 0.025,
        bevelThickness: 0.02,
      });
      bladeGeometry.center();
      const blade = ownedMesh(bladeGeometry, primary);
      blade.position.y = 0.36;
      group.add(blade);
      const guard = ownedMesh(new THREE.BoxGeometry(0.78, 0.14, 0.18), secondary);
      guard.position.y = -0.48;
      group.add(guard);
      const grip = ownedMesh(new THREE.CylinderGeometry(0.09, 0.11, 0.56, 10), material(0x4c3427, 0.75, 0));
      grip.position.y = -0.82;
      group.add(grip);
      const pommel = ownedMesh(new THREE.SphereGeometry(0.15, 12, 8), secondary.clone());
      pommel.position.y = -1.13;
      group.add(pommel);
    },
    essence: () => {
      // Loose essence is a compact cluster, not a miniature orb. The uneven satellites also keep
      // it readable beside a round currency stack when the generated icon is reduced to 32 px.
      const core = ownedMesh(new THREE.OctahedronGeometry(0.5, 0), luminousMaterial(part.colour, 0.38));
      core.scale.set(0.72, 1.2, 0.72);
      core.rotation.set(0.12, 0.34, 0.08);
      group.add(core);
      for (const [x, y, z, scale, angle] of [
        [-0.42, -0.28, 0.04, 0.48, -0.38],
        [0.4, -0.34, -0.02, 0.4, 0.44],
        [0.25, 0.34, -0.08, 0.28, 0.2],
      ] as const) {
        const shard = ownedMesh(
          new THREE.OctahedronGeometry(0.5, 0),
          luminousMaterial(part.accent ?? part.colour, 0.55),
        );
        shard.position.set(x, y, z);
        shard.scale.set(scale * 0.68, scale, scale * 0.68);
        shard.rotation.z = angle;
        group.add(shard);
      }
    },
    ingot: () => {
      const shape = new THREE.Shape();
      shape.moveTo(-0.82, -0.34);
      shape.lineTo(0.82, -0.34);
      shape.lineTo(0.58, 0.34);
      shape.lineTo(-0.58, 0.34);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.58,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.08,
        bevelThickness: 0.08,
        curveSegments: 1,
      });
      geometry.center();
      const bar = ownedMesh(geometry, primary);
      bar.rotation.x = -0.36;
      group.add(bar);
      const stamp = ownedMesh(new THREE.BoxGeometry(0.62, 0.05, 0.24), secondary);
      stamp.position.set(0, 0.36, 0.02);
      group.add(stamp);
    },
    log: () => {
      primary.roughness = 0.94;
      primary.metalness = 0;
      primary.flatShading = true;
      primary.vertexColors = true;
      secondary.roughness = 0.88;
      secondary.metalness = 0;

      const bark = new THREE.CylinderGeometry(0.42, 0.47, 1.9, 12, 4);
      const positions = bark.getAttribute("position");
      const colours = new Float32Array(positions.count * 3);
      for (let index = 0; index < positions.count; index += 1) {
        const x = positions.getX(index);
        const y = positions.getY(index);
        const z = positions.getZ(index);
        const angle = Math.atan2(x, z);
        // Small inward dents keep the existing bounds while breaking the turned-cylinder shape.
        const dent = 1 - 0.035 * (1 + Math.sin(angle * 3 + y * 1.2));
        positions.setX(index, x * dent);
        positions.setZ(index, z * dent);
        const grain = 0.75 + 0.12 * Math.cos(angle * 5) + 0.045 * Math.sin(y * 7 + angle * 2);
        colours.set([grain, grain, grain], index * 3);
      }
      bark.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      bark.computeVertexNormals();
      const body = ownedMesh(bark, primary);
      body.rotation.z = Math.PI / 2;
      group.add(body);

      const grainColour = secondary.color.clone().lerp(primary.color, 0.42);
      for (const x of [-0.96, 0.96]) {
        const radius = (x < 0 ? 0.42 : 0.47) * 0.88;
        const end = ownedMesh(new THREE.CircleGeometry(radius, 12), secondary.clone());
        end.position.x = x;
        end.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2;
        group.add(end);

        // Thin, slightly eccentric end grain stays part of the cut face instead of a raised rim.
        for (const [fraction, offset] of [[0.36, 0.015], [0.69, -0.01]] as const) {
          const ring = ownedMesh(
            new THREE.RingGeometry(radius * fraction - 0.009, radius * fraction, 32),
            material(grainColour.getHex(), 0.94, 0),
          );
          ring.position.set(x + Math.sign(x) * 0.002, offset, 0.012);
          ring.rotation.y = end.rotation.y;
          ring.scale.y = 0.94;
          group.add(ring);
        }
      }
    },
    fish: () => {
      const body = ownedMesh(new THREE.SphereGeometry(0.72, 28, 18), primary);
      body.scale.set(1.35, 0.62, 0.52);
      group.add(body);
      const tail = ownedMesh(new THREE.ConeGeometry(0.48, 0.72, 3), secondary);
      tail.rotation.z = -Math.PI / 2;
      tail.position.x = -1.18;
      group.add(tail);
      const fin = ownedMesh(new THREE.ConeGeometry(0.23, 0.42, 3), secondary);
      fin.position.set(0, 0.48, 0);
      fin.rotation.z = Math.PI;
      group.add(fin);
      const eye = ownedMesh(new THREE.SphereGeometry(0.075, 12, 8), material(0x171514, 0.7, 0));
      eye.position.set(0.62, 0.18, 0.39);
      group.add(eye);
    },
    orb: () => {
      const stone = ownedMesh(new THREE.DodecahedronGeometry(0.68, 1), luminousMaterial(part.colour, 0.34));
      stone.rotation.set(0.2, 0.35, 0.1);
      group.add(stone);
      const orbit = ownedMesh(
        new THREE.TorusGeometry(0.88, 0.055, 10, 48),
        luminousMaterial(part.accent ?? part.colour, 0.68),
      );
      orbit.rotation.x = Math.PI / 2.6;
      group.add(orbit);
    },
    handle: () => {
      const grip = ownedMesh(new THREE.CylinderGeometry(0.11, 0.15, 1.22, 14), primary);
      group.add(grip);
      for (const y of [-0.42, 0, 0.42]) {
        const ridge = ownedMesh(new THREE.TorusGeometry(0.132, 0.018, 8, 20), secondary.clone());
        ridge.rotation.x = Math.PI / 2;
        ridge.position.y = y;
        group.add(ridge);
      }
      const butt = ownedMesh(new THREE.CylinderGeometry(0.17, 0.15, 0.1, 14), secondary.clone());
      butt.position.y = -0.64;
      group.add(butt);
      const shoulder = ownedMesh(new THREE.CylinderGeometry(0.13, 0.11, 0.1, 14), secondary);
      shoulder.position.y = 0.64;
      group.add(shoulder);
    },
    hide: () => {
      primary.roughness = 0.95;
      primary.metalness = 0;
      const shape = new THREE.Shape();
      shape.moveTo(-0.72, 0.8);
      shape.lineTo(-0.35, 0.62);
      shape.lineTo(-0.58, 0.18);
      shape.lineTo(-0.82, -0.65);
      shape.lineTo(-0.32, -0.48);
      shape.lineTo(0, -0.8);
      shape.lineTo(0.32, -0.48);
      shape.lineTo(0.82, -0.65);
      shape.lineTo(0.58, 0.18);
      shape.lineTo(0.35, 0.62);
      shape.lineTo(0.72, 0.8);
      shape.lineTo(0, 0.64);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.12,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.045,
        bevelThickness: 0.04,
      });
      geometry.center();
      const hide = ownedMesh(geometry, primary);
      hide.rotation.set(-0.12, 0.18, 0);
      if (variant === 1) hide.scale.set(1.18, 0.86, 1);
      group.add(hide);
      if (variant === 0) {
        const patch = ownedMesh(new THREE.CircleGeometry(0.3, 14), secondary);
        patch.position.set(0.08, -0.02, 0.12);
        group.add(patch);
      } else {
        for (let crease = 0; crease < 4; crease += 1) {
          hide.add(taperedStrand([
            new THREE.Vector3(-0.39 + crease * 0.1, -0.43, 0.135),
            new THREE.Vector3(-0.24 + crease * 0.12, -0.1, 0.14),
            new THREE.Vector3(0.04 + crease * 0.13, 0.4, 0.135),
          ], 0.015, secondary));
        }
      }
    },
    seed: () => {
      for (const [x, y, angle] of [[-0.42, -0.12, -0.5], [0.1, 0.35, 0.18], [0.46, -0.28, 0.62]] as const) {
        const seed = ownedMesh(new THREE.SphereGeometry(0.34, 18, 12), primary.clone());
        seed.scale.set(0.7, 1.2, 0.48);
        seed.position.set(x, y, 0);
        seed.rotation.z = angle;
        group.add(seed);
      }
      const sprout = ownedMesh(new THREE.ConeGeometry(0.14, 0.48, 5), secondary);
      sprout.position.set(0.26, 0.78, 0);
      sprout.rotation.z = -0.55;
      group.add(sprout);
    },
    shaft: () => {
      const shaft = ownedMesh(new THREE.CylinderGeometry(0.085, 0.085, 2.2, 12), primary);
      group.add(shaft);
      addBand(group, -0.82, part.accent ?? part.colour);
      addBand(group, 0.82, part.accent ?? part.colour);
    },
    rod: () => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.62, -1, 0),
        new THREE.Vector3(-0.32, -0.25, 0),
        new THREE.Vector3(0.12, 0.52, 0),
        new THREE.Vector3(0.62, 1.02, 0),
      ]);
      const rod = ownedMesh(new THREE.TubeGeometry(curve, 24, 0.045, 10, false), primary);
      group.add(rod);
      const reel = ownedMesh(new THREE.TorusGeometry(0.25, 0.065, 10, 32), secondary);
      reel.position.set(-0.34, -0.35, 0.08);
      group.add(reel);
      const handle = ownedMesh(new THREE.CylinderGeometry(0.075, 0.09, 0.48, 10), secondary.clone());
      handle.position.set(-0.66, -0.88, 0);
      handle.rotation.z = -0.36;
      group.add(handle);
    },
    staff: () => {
      const shaft = ownedMesh(new THREE.CylinderGeometry(0.065, 0.09, 2.25, 12), primary);
      group.add(shaft);
      const crown = ownedMesh(new THREE.TorusGeometry(0.34, 0.07, 10, 32), primary.clone());
      crown.position.y = 1.18;
      group.add(crown);
      const stone = ownedMesh(new THREE.OctahedronGeometry(0.25, 0), secondary);
      stone.position.y = 1.18;
      stone.rotation.y = 0.45;
      group.add(stone);
      addBand(group, -0.7, part.accent ?? part.colour);
    },
    ring: () => {
      const ring = ownedMesh(new THREE.TorusGeometry(0.62, 0.115, 16, 48), primary);
      group.add(ring);
      const gem = ownedMesh(new THREE.OctahedronGeometry(0.27, 0), secondary);
      gem.position.y = 0.68;
      gem.rotation.z = Math.PI / 4;
      group.add(gem);
      if (variant === 1) {
        for (let index = 0; index < 14; index += 1) {
          const angle = index / 14 * Math.PI * 2;
          const x = Math.cos(angle);
          const y = Math.sin(angle);
          group.add(taperedStrand([new THREE.Vector3(x * 0.5, y * 0.5, 0.06), new THREE.Vector3(x * 0.44, y * 0.44, 0.14), new THREE.Vector3(x * 0.39 - y * 0.06, y * 0.39 + x * 0.06, 0.18)], 0.05, secondary));
        }
      } else if (variant === 2) {
        const points: THREE.Vector3[] = [];
        for (let step = 0; step <= 160; step += 1) {
          const t = step / 160 * Math.PI * 2;
          const radius = 0.62 + Math.cos(t * 16) * 0.125;
          points.push(new THREE.Vector3(Math.cos(t) * radius, Math.sin(t) * radius, Math.sin(t * 16) * 0.125));
        }
        group.add(ownedMesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 200, 0.024, 6, false), secondary));
      } else if (variant === 3) {
        for (const side of [-1, 0, 1]) group.add(taperedStrand([
          new THREE.Vector3(side * 0.24, 0.61, 0.04), new THREE.Vector3(side * 0.32, 0.85, 0.06), new THREE.Vector3(side * 0.36, 1.05 - Math.abs(side) * 0.12, 0.07),
        ], 0.064, secondary));
      } else if (variant === 4) {
        for (let index = 0; index < 8; index += 1) {
          const angle = index / 8 * Math.PI * 2;
          const plate = organicPlate([[-0.1, -0.14], [0.1, -0.14], [0.14, 0.05], [0, 0.2], [-0.14, 0.05]], 0.08, secondary);
          plate.position.set(Math.cos(angle) * 0.6, Math.sin(angle) * 0.6, 0.06);
          plate.rotation.z = angle - Math.PI / 2;
          group.add(plate);
        }
      }
    },
    amulet: () => {
      const chain = ownedMesh(new THREE.TorusGeometry(0.7, 0.045, 10, 48), primary);
      chain.scale.y = 1.18;
      chain.position.y = 0.25;
      group.add(chain);
      if (variant === 0) {
        const gem = ownedMesh(new THREE.OctahedronGeometry(0.38, 0), secondary);
        gem.position.y = -0.7;
        gem.rotation.z = Math.PI / 4;
        group.add(gem);
      } else if (variant === 1) {
        for (const side of [-1, 0, 1]) {
          const feather = buildItemIconPrimitive({ kind: "primitive", primitive: "feather", colour: part.accent ?? part.colour, accent: part.colour, variant: 2 });
          feather.scale.setScalar(0.31);
          feather.position.set(side * 0.13, -0.77, 0.04);
          feather.rotation.z = side * 0.4 + Math.PI;
          group.add(feather);
        }
      } else if (variant === 2) {
        for (const side of [-1, 1]) {
          group.add(taperedStrand([new THREE.Vector3(0, -0.43, 0.05), new THREE.Vector3(side * 0.2, -0.85, 0.05), new THREE.Vector3(side * 0.28, -1.1, 0.05)], 0.085, secondary));
        }
        const binding = ownedMesh(new THREE.TorusGeometry(0.1, 0.045, 8, 16), primary);
        binding.position.y = -0.5;
        group.add(binding);
      } else {
        const ornament = buildItemIconPrimitive({ kind: "primitive", primitive: variant === 3 ? "antler-palm" : "claw", colour: part.accent ?? part.colour, accent: part.colour, variant: variant === 4 ? 3 : 0 });
        ornament.scale.setScalar(0.44);
        ornament.position.y = -0.79;
        group.add(ornament);
      }
    },

    // ------------------------------------------------------------------ animal drops
    // Seven shapes, added with the animals. Each one is the silhouette a player has to recognise
    // at 48 px in an inventory grid, so they lean on outline rather than detail: meat is a bone
    // through a mass, horn is a taper with a curl, feather is a spine with two vanes.
    meat: () => {
      const flesh = ownedMesh(new THREE.SphereGeometry(0.66, 24, 16), primary);
      flesh.scale.set(1.18, 0.92, 0.72);
      flesh.position.y = -0.12;
      group.add(flesh);
      // The bone reads the shape as a joint rather than a rock, which is the whole job.
      const bone = ownedMesh(new THREE.CylinderGeometry(0.11, 0.11, 1.05, 10), secondary);
      bone.position.set(0.12, 0.66, 0);
      bone.rotation.z = -0.42;
      group.add(bone);
      for (const y of [0.42, -0.42]) {
        const knuckle = ownedMesh(new THREE.SphereGeometry(0.16, 12, 10), secondary.clone());
        knuckle.position.set(0.12 + y * 0.44, 0.66 + y * 0.95, 0);
        group.add(knuckle);
      }
    },
    horn: () => {
      // One curled taper. Sampling a spiral rather than stacking cones keeps the outline smooth
      // at icon size, where a faceted horn reads as a screw.
      const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 16; step += 1) {
        const t = step / 16;
        const angle = t * Math.PI * 1.35;
        const radius = 0.72 * (1 - 0.35 * t);
        points.push(new THREE.Vector3(
          Math.cos(angle) * radius - 0.34,
          t * 1.5 - 0.72,
          Math.sin(angle) * radius * 0.32,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const horn = ownedMesh(new THREE.TubeGeometry(curve, 40, 0.19, 12, false), primary);
      horn.scale.set(1, 1, 1);
      group.add(horn);
      const cuff = ownedMesh(new THREE.TorusGeometry(0.2, 0.055, 8, 20), secondary);
      cuff.position.copy(points[0]!);
      cuff.rotation.x = Math.PI / 2;
      group.add(cuff);
    },
    antler: () => {
      const beam = ownedMesh(new THREE.CylinderGeometry(0.09, 0.15, 1.6, 10), primary);
      beam.rotation.z = 0.2;
      group.add(beam);
      // Three tines up one side, shortening as they climb: the read that says "antler" and not
      // "stick" is the alternating rhythm, so the spacing is uneven on purpose.
      for (const [y, length, angle] of [[-0.28, 0.72, 1.0], [0.24, 0.6, 0.85], [0.66, 0.44, 0.7]] as const) {
        const tine = ownedMesh(new THREE.CylinderGeometry(0.055, 0.085, length, 8), primary.clone());
        tine.position.set(0.3 + length * 0.22, y + length * 0.3, 0);
        tine.rotation.z = -angle;
        group.add(tine);
      }
      const burr = ownedMesh(new THREE.TorusGeometry(0.17, 0.06, 8, 18), secondary);
      burr.position.set(-0.17, -0.78, 0);
      burr.rotation.x = Math.PI / 2;
      group.add(burr);
    },
    feather: () => {
      primary.roughness = 0.94;
      primary.metalness = 0;
      // The quill has to stick out below the vanes or the whole thing reads as a leaf. It is the
      // one detail that separates the two silhouettes at 48 px, so the spine runs the full length
      // and the vanes stop well short of its base.
      const spine = ownedMesh(new THREE.CylinderGeometry(0.03, 0.062, 2.05, 8), secondary);
      spine.position.y = 0.06;
      group.add(spine);
      const quill = ownedMesh(new THREE.CylinderGeometry(0.062, 0.05, 0.3, 8), secondary.clone());
      quill.position.y = -1.06;
      group.add(quill);
      // Two vanes, deliberately unequal. A real feather is asymmetric about its shaft, and the
      // symmetric version was exactly what made this look like a leaf.
      for (const [side, baseWidth] of [[-1, 0.34], [1, 0.56]] as const) {
        const width = baseWidth * (variant === 1 ? 0.78 : variant === 2 ? 1.18 : 1);
        const vane = new THREE.Shape();
        vane.moveTo(0, -0.72);
        vane.quadraticCurveTo(side * width * 1.15, -0.1, side * width, 0.6);
        vane.quadraticCurveTo(side * width * 0.62, 0.92, 0, 1.0);
        vane.closePath();
        const geometry = new THREE.ExtrudeGeometry(vane, {
          depth: 0.05, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.02, bevelThickness: 0.015,
        });
        const vaneMaterial = primary.clone();
        if (variant > 0) {
          const position = geometry.getAttribute("position");
          const colours: number[] = [];
          for (let index = 0; index < position.count; index += 1) {
            const y = position.getY(index);
            const stripe = Math.sin((y + Math.abs(position.getX(index)) * 0.22) * (variant === 2 ? 16 : 22)) > 0.1 ? 0.48 : 1;
            colours.push(stripe, stripe, stripe);
          }
          geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
          vaneMaterial.vertexColors = true;
        }
        group.add(ownedMesh(geometry, vaneMaterial));
        for (let barb = 0; barb < 9; barb += 1) {
          const y = -0.55 + barb * 0.15;
          const reach = Math.sin((barb + 1) / 11 * Math.PI) * width * 0.82;
          group.add(taperedStrand([new THREE.Vector3(0, y, 0.066), new THREE.Vector3(side * reach * 0.6, y + 0.08, 0.07), new THREE.Vector3(side * reach, y + 0.17, 0.065)], 0.009, secondary));
        }
      }
    },
    egg: () => {
      const shell = ownedMesh(new THREE.SphereGeometry(0.68, 24, 18), primary);
      // A real egg is not an ellipsoid: it is fatter below the equator. Scaling the lower half
      // separately is cheaper than a lathe and reads correctly at icon size.
      const position = shell.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i += 1) {
        const y = position.getY(i);
        const taper = y > 0 ? 1 - 0.22 * (y / 0.68) : 1 + 0.06 * (-y / 0.68);
        position.setX(i, position.getX(i) * taper);
        position.setZ(i, position.getZ(i) * taper);
        position.setY(i, y * 1.28);
      }
      position.needsUpdate = true;
      shell.geometry.computeVertexNormals();
      group.add(shell);
      const speckle = ownedMesh(new THREE.SphereGeometry(0.07, 8, 6), secondary);
      speckle.position.set(0.22, 0.3, 0.52);
      group.add(speckle);
    },
    claw: () => {
      // A hooked taper. Same spiral trick as `horn` over a much tighter arc, which is the whole
      // difference between a claw and a horn at this size.
      const points: THREE.Vector3[] = [];
      for (let step = 0; step <= 14; step += 1) {
        const t = step / 14;
        const angle = -0.35 + t * (variant === 1 ? 1.85 : variant === 3 ? 2.15 : 1.5);
        points.push(new THREE.Vector3(
          Math.cos(angle) * 1.05 - 0.5,
          Math.sin(angle) * (variant === 3 ? 1.3 : 1.05) - 0.45,
          0,
        ));
      }
      const claw = taperedStrand(points, variant === 2 ? 0.23 : 0.16, primary);
      group.add(claw);
      const quick = ownedMesh(new THREE.SphereGeometry(0.19, 12, 10), secondary);
      quick.position.copy(points[0]!);
      group.add(quick);
      if (variant === 1 || variant === 3) {
        for (const index of [2, 5, 8, 11]) {
          const base = points[index]!;
          group.add(taperedStrand([base.clone(), base.clone().add(new THREE.Vector3(-0.13, -0.02, 0)), base.clone().add(new THREE.Vector3(-0.26, 0.06, 0))], 0.064, secondary));
        }
      }
    },
    gland: () => {
      const sac = ownedMesh(new THREE.SphereGeometry(0.62, 22, 16), primary);
      sac.scale.set(0.92, 1.15, 0.82);
      sac.position.y = -0.1;
      group.add(sac);
      const neck = ownedMesh(new THREE.CylinderGeometry(0.13, 0.24, 0.5, 12), secondary);
      neck.position.y = 0.66;
      group.add(neck);
      const tie = ownedMesh(new THREE.TorusGeometry(0.15, 0.05, 8, 18), secondary.clone());
      tie.position.y = 0.84;
      tie.rotation.x = Math.PI / 2;
      group.add(tie);
      if (variant > 0) {
        group.remove(neck, tie);
        neck.geometry.dispose();
        tie.geometry.dispose();
        primary.roughness = variant === 2 ? 0.24 : 0.38;
        sac.scale.set(variant === 2 ? 1.35 : 0.82, variant === 2 ? 0.65 : 1.08, 0.7);
        for (let index = 0; index < 4; index += 1) {
          const lobe = ownedMesh(new THREE.SphereGeometry(0.13 + index * 0.025, 12, 10), secondary);
          lobe.position.set(-0.38 + index * 0.24, -0.15 + Math.sin(index * 1.8) * 0.21, 0.42);
          group.add(lobe);
        }
      }
    },
    tuft: () => {
      primary.roughness = 0.97;
      secondary.roughness = 0.98;
      secondary.metalness = 0;
      const count = variant === 1 ? 11 : variant === 2 ? 13 : 9;
      for (let index = 0; index < count; index += 1) {
        const offset = index / (count - 1) - 0.5;
        const spread = offset * (variant === 3 ? 1.45 : 1.0);
        const length = (variant === 1 ? 1.2 : 1.5) - Math.abs(offset) * 0.55 + Math.sin(index * 1.7) * 0.12;
        const points: THREE.Vector3[] = [];
        for (let step = 0; step <= 12; step += 1) {
          const t = step / 12;
          const curl = variant === 2 ? Math.sin(t * Math.PI * 4 + index) * 0.11 * t : Math.sin(t * Math.PI) * 0.055;
          points.push(new THREE.Vector3(spread * t + curl, -0.65 + t * length, Math.sin(index * 2.4) * 0.12 + curl));
        }
        const radius = variant === 1 ? 0.047 : variant === 2 ? 0.09 : variant === 3 ? 0.071 : 0.08;
        group.add(taperedStrand(points, radius, index % 3 === 0 ? secondary : primary));
      }
      const rootTie = ownedMesh(new THREE.TorusGeometry(0.105, 0.035, 8, 20), secondary);
      rootTie.rotation.x = Math.PI / 2;
      rootTie.position.y = -0.57;
      group.add(rootTie);
    },
    cord: () => {
      primary.roughness = variant === 2 ? 0.55 : 0.96;
      primary.metalness = 0;
      const fibers = variant === 1 ? 6 : variant === 0 ? 3 : 2;
      for (let fiber = 0; fiber < fibers; fiber += 1) {
        const points: THREE.Vector3[] = [];
        for (let step = 0; step <= 60; step += 1) {
          const t = step / 60;
          const angle = t * Math.PI * (variant === 2 ? 4.5 : 3.4) - 0.8;
          const radius = 0.58 - t * 0.18;
          const twist = t * Math.PI * 16 + fiber * Math.PI * 2 / fibers;
          points.push(new THREE.Vector3(Math.cos(angle) * radius + Math.cos(twist) * 0.028,
            Math.sin(angle) * radius + (t > 0.85 ? (t - 0.85) * 2.7 : 0),
            t * 0.14 + Math.sin(twist) * 0.028));
        }
        const curve = new THREE.CatmullRomCurve3(points);
        group.add(ownedMesh(new THREE.TubeGeometry(curve, 100, variant === 1 ? 0.022 : 0.03, 6, false), fiber % 2 ? secondary : primary));
      }
    },
    quill: () => {
      const count = variant === 1 ? 1 : 3;
      for (let index = 0; index < count; index += 1) {
        const quill = new THREE.Group();
        quill.position.x = (index - (count - 1) / 2) * 0.23;
        quill.rotation.z = (index - (count - 1) / 2) * -0.16 + 0.12;
        const length = 1.9 - index * 0.12;
        quill.add(taperedStrand([new THREE.Vector3(0, -0.95, 0), new THREE.Vector3(0.07, 0.2, 0), new THREE.Vector3(0.13, length - 0.95, 0)], variant === 1 ? 0.045 : 0.073, primary));
        if (variant === 0) {
          for (const y of [-0.58, -0.2, 0.18, 0.52]) {
            const band = ownedMesh(new THREE.CylinderGeometry(0.043 - y * 0.022, 0.047 - y * 0.022, 0.14, 10), secondary);
            band.position.set((y + 0.95) * 0.07, y, 0);
            band.rotation.z = -0.06;
            quill.add(band);
          }
        } else {
          for (let barb = 0; barb < 13; barb += 1) {
            const y = -0.28 + barb * 0.088;
            const width = Math.sin((barb + 1) / 15 * Math.PI) * 0.3;
            for (const side of [-1, 1]) quill.add(taperedStrand([
              new THREE.Vector3(0.06, y, 0), new THREE.Vector3(side * width * 0.72 + 0.07, y + 0.13, 0),
              new THREE.Vector3(side * width + 0.07, y + 0.23, 0),
            ], 0.025, primary));
          }
        }
        group.add(quill);
      }
    },
    scute: () => {
      primary.roughness = 0.73;
      primary.metalness = 0;
      secondary.roughness = 0.86;
      secondary.metalness = 0;
      const outlines: readonly (readonly (readonly [number, number])[])[] = [
        [[-0.52, -0.6], [0.4, -0.6], [0.61, -0.15], [0.4, 0.45], [0, 0.8], [-0.45, 0.42], [-0.6, -0.12]],
        [[-0.38, -0.66], [0.34, -0.66], [0.54, -0.35], [0.45, 0.33], [0.08, 0.85], [-0.4, 0.44], [-0.57, -0.1]],
        [[0, -0.8], [0.55, -0.38], [0.62, 0.3], [0.38, 0.7], [-0.3, 0.7], [-0.66, 0.2], [-0.49, -0.4]],
        [[-0.42, -0.64], [0.38, -0.75], [0.7, -0.18], [0.52, 0.2], [0.67, 0.64], [0.09, 0.84], [-0.6, 0.48], [-0.5, 0.02]],
      ];
      const plate = organicPlate(outlines[variant % outlines.length]!, 0.13, primary);
      plate.rotation.set(-0.16, -0.1, variant === 3 ? -0.16 : 0.12);
      group.add(plate);
      const ridge = organicPlate([[-0.065, -0.49], [0.07, -0.46], [0.095, 0.33], [0, 0.65], [-0.07, 0.26]], variant === 0 ? 0.12 : 0.055, secondary);
      ridge.position.z = 0.15;
      plate.add(ridge);
      if (variant === 0 || variant === 1) {
        for (const y of [-0.3, 0.02, 0.3]) {
          const seam = ownedMesh(new THREE.BoxGeometry(0.74 - Math.abs(y) * 0.3, 0.025, 0.025), secondary);
          seam.position.set(0, y, 0.18);
          plate.add(seam);
        }
      }
    },
    shell: () => {
      primary.roughness = 0.82;
      primary.metalness = 0;
      const shell = ownedMesh(new THREE.SphereGeometry(0.8, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), primary);
      shell.scale.set(1, 0.65, 1.13);
      group.add(shell);
      const lip = ownedMesh(new THREE.TorusGeometry(0.8, 0.047, 10, 48), secondary);
      lip.rotation.x = Math.PI / 2;
      lip.scale.y = 1.13;
      group.add(lip);
      const underside = ownedMesh(new THREE.CircleGeometry(0.78, 32), material(0x392f22, 0.96, 0));
      underside.rotation.x = Math.PI / 2;
      underside.scale.y = 1.13;
      underside.position.y = 0.02;
      group.add(underside);
      for (const z of [-0.53, -0.2, 0.2, 0.53]) {
        const points: THREE.Vector3[] = [];
        const normalizedZ = z / 1.13;
        const radius = Math.sqrt(0.8 ** 2 - normalizedZ ** 2);
        for (let step = 0; step <= 20; step += 1) {
          const angle = step / 20 * Math.PI;
          points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.65 + 0.008, z));
        }
        group.add(ownedMesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.012, 6, false), secondary));
      }
      for (const x of [-0.26, 0.26]) {
        const points: THREE.Vector3[] = [];
        const radius = Math.sqrt(0.8 ** 2 - x ** 2);
        for (let step = 0; step <= 20; step += 1) {
          const angle = step / 20 * Math.PI;
          points.push(new THREE.Vector3(x, Math.sin(angle) * radius * 0.65 + 0.009, Math.cos(angle) * radius * 1.13));
        }
        group.add(ownedMesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.012, 6, false), secondary));
      }
    },
    "antler-palm": () => {
      primary.roughness = 0.94;
      primary.metalness = 0;
      const palm = organicPlate([
        [-0.14, -0.74], [0.12, -0.75], [0.26, -0.28], [0.64, -0.07], [0.9, 0.19],
        [0.57, 0.14], [0.75, 0.67], [0.43, 0.36], [0.4, 0.98], [0.14, 0.5],
        [-0.08, 1.06], [-0.19, 0.5], [-0.55, 0.8], [-0.46, 0.25], [-0.76, 0.42], [-0.42, -0.05], [-0.2, -0.3],
      ], 0.11, primary);
      group.add(palm);
      const burr = ownedMesh(new THREE.TorusGeometry(0.16, 0.04, 8, 20), secondary);
      burr.rotation.x = Math.PI / 2;
      burr.position.set(-0.02, -0.65, 0.05);
      group.add(burr);
      for (const x of [-0.23, 0.05, 0.28]) {
        group.add(taperedStrand([new THREE.Vector3(-0.02, -0.5, 0.15), new THREE.Vector3(x * 0.7, 0.03, 0.155), new THREE.Vector3(x, 0.42, 0.15)], 0.022, secondary));
      }
    },
  };

  builders[part.primitive]();
  return group;
}

function tintObject(
  object: THREE.Object3D,
  colour?: number,
  accent?: number,
  surfaceTreatment?: ItemIconAssetPart["surfaceTreatment"],
  materialLift?: number,
): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const sourceColours = mesh.geometry.getAttribute("color");
    const bakedVertexColour = surfaceTreatment !== undefined && sourceColours !== undefined;
    if (bakedVertexColour) {
      // Rebuild the live palette around the cooked colour while retaining every authored light and
      // dark marking. The clone owns this geometry; the registry's shared GLB remains untouched.
      const geometry = mesh.geometry.clone();
      geometry.userData["itemIconOwned"] = true;
      const values = new Float32Array(sourceColours.count * sourceColours.itemSize);
      const target = new THREE.Color(colour ?? 0xffffff);
      for (let index = 0; index < sourceColours.count; index += 1) {
        const luma = sourceColours.getX(index) * 0.2126
          + sourceColours.getY(index) * 0.7152
          + sourceColours.getZ(index) * 0.0722;
        const tone = 0.48 + luma * 0.72;
        const offset = index * sourceColours.itemSize;
        values[offset] = Math.min(1, target.r * tone);
        values[offset + 1] = Math.min(1, target.g * tone);
        values[offset + 2] = Math.min(1, target.b * tone);
        if (sourceColours.itemSize > 3) values[offset + 3] = sourceColours.getW(index);
      }
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(values, sourceColours.itemSize));
      mesh.geometry = geometry;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const tint = (source: THREE.Material): THREE.Material => {
      const clone = source.clone();
      const standard = clone as Partial<THREE.MeshStandardMaterial>;
      if (colour !== undefined && standard.color instanceof THREE.Color) {
        // Resource tints multiply the authored surface. Keep painted details, vertex colours,
        // normal maps and the original roughness instead of flattening the whole object.
        standard.color.setHex(bakedVertexColour ? 0xffffff : colour);
        standard.needsUpdate = true;
      }
      if (accent !== undefined && standard.emissive instanceof THREE.Color) {
        const localized = Boolean(standard.emissiveMap) || source.userData["equipmentRole"] === "gem";
        if (localized) {
          standard.emissive.setHex(accent);
          standard.emissiveIntensity = 0.15;
        }
      }
      if (surfaceTreatment === "seared") {
        // A dry, warm surface reads as cooked. Authored markings remain in the recoloured vertex
        // data instead of the live blue palette.
        if (typeof standard.roughness === "number") standard.roughness = Math.max(standard.roughness, 0.76);
        if (typeof standard.metalness === "number") standard.metalness = 0;
      } else if (surfaceTreatment === "charred") {
        // Burnt fish stay lifted above black so their fins remain legible against the dark UI.
        if (typeof standard.roughness === "number") standard.roughness = 0.94;
        if (typeof standard.metalness === "number") standard.metalness = 0;
      }
      if (materialLift !== undefined && standard.emissive instanceof THREE.Color) {
        standard.emissive.setHex(colour ?? 0xffffff);
        standard.emissiveIntensity = materialLift;
      }
      return clone;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
  });
}

/** Clone cached assets before applying the same material and socket treatment worn gear uses. */
export function prepareItemIconAsset(
  source: THREE.Object3D,
  part: ItemIconAssetPart,
  presentation?: ItemIconAppearance["presentation"],
): THREE.Object3D {
  let object = cloneSkeleton(source);
  if (part.gearAppearance) {
    const borrowedMaterials = new Set<THREE.Material>();
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const entry of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) borrowedMaterials.add(entry);
    });
    applyGearAppearance(object, part.gearAppearance);
    // An untinted item may still share its source material. Every icon owns its disposable
    // materials, but textures and authored geometry remain borrowed from the registry.
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const own = (entry: THREE.Material): THREE.Material => borrowedMaterials.has(entry) ? entry.clone() : entry;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    });
  } else {
    tintObject(object, part.colour, part.accent, part.surfaceTreatment, part.materialLift);
  }
  if (presentation === "paired-hands") object = stagePairedHands(object, part.assetId);
  if (part.scale !== undefined) object.scale.multiplyScalar(part.scale);
  if (part.wornRest) {
    // A skinned outfit part already carries its bind pose, so it lands on the body at the origin.
    // An additive tier piece is authored around its carrier joint and has to be put back there.
    object.position.set(...part.wornRest.position);
    object.rotation.set(...part.wornRest.rotation);
  }
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (part.gearAppearance?.orb && mesh.name.startsWith("magic-weapon-socket-")) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return object;
}

type IconVertex = Record<string, number[]>;

/**
 * The authored glove GLBs include full sleeves. Cut a cuff behind the existing forearm armour,
 * retain the real fingers and thumbs, and stage the two hands with their dorsal faces forward.
 * All cuts interpolate the source UVs and colours; cached geometry and skeletons stay untouched.
 */
function stagePairedHands(object: THREE.Object3D, assetId: string): THREE.Group {
  object.updateMatrixWorld(true);
  const pair = new THREE.Group();
  pair.name = "item-icon-paired-hands";
  const isKnight = assetId.includes("knight");
  const cuffLength = isKnight ? 0.2382 : 0.1332;
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (const side of [-1, 1] as const) {
    const wristBone = object.getObjectByName(side === 1 ? "hand_l" : "hand_r");
    if (!wristBone) throw new Error(`Paired glove icon requires authored hand bones: ${assetId}`);
    const wrist = wristBone.getWorldPosition(new THREE.Vector3());
    const hand = new THREE.Group();
    hand.name = side === 1 ? "item-icon-left-glove" : "item-icon-right-glove";
    hand.position.set(side * (isKnight ? 0.105 : 0.09), side * 0.02, 0);
    hand.rotation.z = -side * 0.12;
    pair.add(hand);
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.geometry;
      const position = source.getAttribute("position");
      if (!position) return;
      const attributes = Object.entries(source.attributes)
        .filter(([name]) => name !== "skinIndex" && name !== "skinWeight");
      const values = new Map(attributes.map(([name]) => [name, [] as number[]]));
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      const boundaries: [IconVertex, IconVertex][] = [];
      const output = new THREE.BufferGeometry();
      const vertex = (index: number): IconVertex => {
        const result: IconVertex = {};
        for (const [name, attribute] of attributes) {
          result[name] = Array.from({ length: attribute.itemSize }, (_, axis) => attribute.getComponent(index, axis));
        }
        mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld).sub(wrist);
        result.position = [side * point.z, side * point.x, point.y];
        if (result.normal) {
          normal.fromArray(result.normal).applyMatrix3(normalMatrix).normalize();
          result.normal = [side * normal.z, side * normal.x, normal.y];
        }
        if (result.tangent) {
          normal.fromArray(result.tangent).transformDirection(mesh.matrixWorld);
          result.tangent = [side * normal.z, side * normal.x, normal.y, result.tangent[3]!];
        }
        return result;
      };
      const interpolate = (a: IconVertex, b: IconVertex, t: number): IconVertex => Object.fromEntries(
        attributes.map(([name]) => [name, a[name]!.map((value, axis) => value + (b[name]![axis]! - value) * t)]),
      );
      const append = (value: IconVertex): void => {
        for (const [name] of attributes) values.get(name)!.push(...value[name]!);
      };
      const indexCount = source.index?.count ?? position.count;
      for (let offset = 0; offset < indexCount; offset += 3) {
        const triangle = [0, 1, 2].map((corner) => vertex(source.index?.getX(offset + corner) ?? offset + corner));
        // The other arm lies entirely behind this hand's cuff plane.
        const clipped: IconVertex[] = [];
        const cut: IconVertex[] = [];
        for (let edge = 0; edge < 3; edge += 1) {
          const a = triangle[edge]!;
          const b = triangle[(edge + 1) % 3]!;
          const ay = a.position![1]! + cuffLength;
          const by = b.position![1]! + cuffLength;
          if (ay >= 0) clipped.push(a);
          if ((ay >= 0) !== (by >= 0)) {
            const intersection = interpolate(a, b, ay / (ay - by));
            clipped.push(intersection);
            cut.push(intersection);
          }
        }
        if (cut.length === 2) boundaries.push([cut[0]!, cut[1]!]);
        if (clipped.length < 3) continue;
        const start = values.get("position")!.length / 3;
        for (let fan = 1; fan < clipped.length - 1; fan += 1) {
          append(clipped[0]!);
          append(clipped[fan]!);
          append(clipped[fan + 1]!);
        }
        const count = values.get("position")!.length / 3 - start;
        const group = source.groups.find((entry) => offset >= entry.start && offset < entry.start + entry.count);
        const last = output.groups[output.groups.length - 1];
        const materialIndex = group?.materialIndex ?? 0;
        if (last && last.materialIndex === materialIndex && last.start + last.count === start) last.count += count;
        else output.addGroup(start, count, materialIndex);
      }
      if (values.get("position")!.length === 0) return;
      for (const [name, attribute] of attributes) output.setAttribute(name, new THREE.Float32BufferAttribute(values.get(name)!, attribute.itemSize));
      output.normalizeNormals();
      output.computeBoundingBox();
      output.computeBoundingSphere();
      output.userData["itemIconOwned"] = true;
      const staged = new THREE.Mesh(output, mesh.material);
      staged.name = `${mesh.name}-icon-${side === 1 ? "left" : "right"}`;
      hand.add(staged);
      if (boundaries.length > 0) hand.add(buildGloveCuffLining(boundaries, cuffLength));
    });
    if (hand.children.length === 0) throw new Error(`Paired glove icon has no authored hand geometry: ${assetId}`);
  }
  return pair;
}

/** A narrow cuff wall ends in a recessed dark lining, so the sleeve cut is a finished opening. */
function buildGloveCuffLining(boundaries: readonly [IconVertex, IconVertex][], cuffLength: number): THREE.Mesh {
  const centre = new THREE.Vector3();
  for (const segment of boundaries) for (const vertex of segment) centre.add(new THREE.Vector3().fromArray(vertex.position!));
  centre.divideScalar(boundaries.length * 2);
  centre.y = -cuffLength + 0.026;
  const positions: number[] = [];
  for (const [a, b] of boundaries) {
    const outerA = new THREE.Vector3().fromArray(a.position!);
    const outerB = new THREE.Vector3().fromArray(b.position!);
    const innerA = outerA.clone().lerp(centre, 0.14);
    const innerB = outerB.clone().lerp(centre, 0.14);
    innerA.y = centre.y;
    innerB.y = centre.y;
    for (const vertex of [outerA, outerB, innerB, outerA, innerB, innerA, innerA, innerB, centre]) positions.push(...vertex.toArray());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const lining = material(0x302820, 0.94, 0);
  lining.side = THREE.DoubleSide;
  const mesh = ownedMesh(geometry, lining);
  mesh.name = "item-icon-cuff-lining";
  return mesh;
}

async function buildAppearance(appearance: ItemIconAppearance): Promise<THREE.Group> {
  const container = new THREE.Group();
  for (const part of appearance.parts) {
    if (part.kind === "primitive") {
      const object = buildItemIconPrimitive(part);
      container.add(object);
      continue;
    }
    const source = await assets.load(part.assetId);
    const object = prepareItemIconAsset(source, part, appearance.presentation);
    container.add(object);
    if (!assets.entry(part.assetId) && !isProceduralGearAsset(part.assetId)) {
      throw new Error(`Missing manifest entry for item icon asset: ${part.assetId}`);
    }
  }
  if (appearance.rotation) container.rotation.set(...appearance.rotation);
  return container;
}

function disposeCurrent(): void {
  const disposedGeometry = new Set<THREE.BufferGeometry>();
  const disposedMaterial = new Set<THREE.Material>();
  for (const child of [...root.children]) {
    child.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry.userData["itemIconOwned"] === true && !disposedGeometry.has(mesh.geometry)) {
        disposedGeometry.add(mesh.geometry);
        mesh.geometry.dispose();
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const entry of materials) {
        if (disposedMaterial.has(entry)) continue;
        disposedMaterial.add(entry);
        entry.dispose();
      }
    });
    root.remove(child);
  }
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
}

/** Measure drawn vertices, including authored skinning, cuffs and added elemental sockets. */
function itemIconVertexBounds(object: THREE.Object3D, view?: THREE.Matrix4): THREE.Box3 {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  object.traverseVisible((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.every(entry => !entry.visible)) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const count = geometry.index?.count ?? position.count;
    const start = Math.max(0, geometry.drawRange.start);
    const end = Math.min(count, start + geometry.drawRange.count);
    for (let index = start; index < end; index += 1) {
      mesh.getVertexPosition(geometry.index?.getX(index) ?? index, point).applyMatrix4(mesh.matrixWorld);
      if (view) point.applyMatrix4(view);
      bounds.expandByPoint(point);
    }
  });
  return bounds;
}

/** Fit an isolated icon root under an untransformed scene without altering any source geometry. */
export function fitItemIconCamera(
  iconRoot: THREE.Group,
  viewCamera: THREE.OrthographicCamera,
  appearance: Pick<ItemIconAppearance, "itemId" | "frameScale">,
): void {
  iconRoot.updateMatrixWorld(true);
  const bounds = itemIconVertexBounds(iconRoot);
  if (bounds.isEmpty()) throw new Error(`Item icon has empty bounds: ${appearance.itemId}`);
  const size = bounds.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 0) throw new Error(`Item icon has invalid bounds: ${appearance.itemId}`);
  const frameScale = appearance.frameScale ?? 1;
  if (!Number.isFinite(frameScale) || frameScale <= 0) throw new Error(`Item icon has invalid frame scale: ${appearance.itemId}`);

  // Keep the studio lighting scale stable. Translation and uniform scale affect only this clone.
  const scale = 2 / longest;
  iconRoot.position.sub(bounds.getCenter(new THREE.Vector3())).multiplyScalar(scale);
  iconRoot.scale.multiplyScalar(scale);
  iconRoot.updateMatrixWorld(true);

  viewCamera.position.copy(CAMERA_DIRECTION).multiplyScalar(6);
  viewCamera.lookAt(0, 0, 0);
  viewCamera.updateMatrixWorld(true);

  // Rotating a box and projecting its corners creates empty space around thin, diagonal assets.
  // Fit the projected geometry itself and centre its visible outline in the orthographic frame.
  const projected = itemIconVertexBounds(iconRoot, viewCamera.matrixWorldInverse);
  const extent = projected.getSize(new THREE.Vector3());
  const centre = projected.getCenter(new THREE.Vector3());
  const half = Math.max(extent.x, extent.y) * 0.5 * frameScale / 0.82;
  if (!Number.isFinite(half) || half <= 0) throw new Error(`Item icon has invalid projected bounds: ${appearance.itemId}`);
  viewCamera.left = centre.x - half;
  viewCamera.right = centre.x + half;
  viewCamera.top = centre.y + half;
  viewCamera.bottom = centre.y - half;
  viewCamera.updateProjectionMatrix();
}

async function render(itemId: ItemId, state?: ItemIconPresentationState): Promise<string> {
  disposeCurrent();
  const appearance = itemIconAppearance(itemId, state);
  root.add(await buildAppearance(appearance));
  await awaitFabArmorTextures();
  setFabMagicSampleTime(4);
  fitItemIconCamera(root, camera, appearance);
  renderer.clear();
  renderer.render(scene, camera);
  setFabMagicSampleTime(null);
  return renderer.domElement.toDataURL("image/png");
}

if (typeof window !== "undefined") {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    premultipliedAlpha: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment, 0.04).texture;
  scene.environmentIntensity = 0.65;
  environment.dispose();
  pmrem.dispose();
  document.body.appendChild(renderer.domElement);
  const api: ItemIconRendererApi = { ready: false, render };
  window.__itemIconRenderer = api;
  await assets.loadManifest();
  api.ready = true;
}
