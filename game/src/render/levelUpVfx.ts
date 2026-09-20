/**
 * Short level-up burst built from the Hovl Studio Magic Effects FREE atlas.
 *
 * Cropped ring, rune, glyph and spark cells build the ground seal plus one instanced trail layer.
 * The whole effect costs four short-lived draw calls and zero when idle. It owns no progression state. A
 * `level.gained` event starts it and the render clock ages it out.
 */
import * as THREE from "three";
import type { Vec3 } from "../contracts.js";
import { assetBaseUrl } from "../app/config.js";

export const LEVEL_UP_DURATION_MS = 2500;

const ATLAS_GRID = 4;
const atlasUrl = (): string => `${assetBaseUrl()}vfx/spell-atlas.png`;
const MAX_INSTANCES = 96;
const ORBIT_HEAD_COUNT = 12;
const TRAIL_SEGMENTS = 7;
const RISING_SPARK_COUNT = 10;
const MAX_TRAIL_VERTICES = ORBIT_HEAD_COUNT * TRAIL_SEGMENTS * 2 * 2;
const TAU = Math.PI * 2;
const MIN_BRIGHTNESS = 0.004;

interface Burst {
  bornAtMs: number;
  seed: number;
}

interface CircleLayer {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  texture: THREE.Texture;
  size: number;
  spin: number;
  gain: number;
  rise: number;
}

export interface LevelUpVfxDeps {
  parent: THREE.Object3D;
  camera: THREE.Camera;
  /** Live player position. The brief celebration follows a moving player. */
  playerPosition(): Vec3;
}

/** Warm ivory at the centre, muted candle gold at the moving edges. */
export const LEVEL_UP_COLOURS = { core: 0xfff8dc, edge: 0xf2d27a } as const;

export class LevelUpVfx {
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly texture: THREE.Texture;
  private readonly trailGeometry: THREE.BufferGeometry;
  private readonly trailMaterial: THREE.LineBasicMaterial;
  private readonly trailLines: THREE.LineSegments;
  private readonly trailPositions = new Float32Array(MAX_TRAIL_VERTICES * 3);
  private readonly trailColours = new Float32Array(MAX_TRAIL_VERTICES * 3);
  private readonly circleGeometry: THREE.PlaneGeometry;
  private readonly circleLayers: CircleLayer[];
  private readonly bursts: Burst[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly facing = new THREE.Quaternion();
  private readonly spin = new THREE.Quaternion();
  private readonly orient = new THREE.Quaternion();
  private readonly colour = new THREE.Color();
  private readonly core = new THREE.Color(LEVEL_UP_COLOURS.core);
  private readonly edge = new THREE.Color(LEVEL_UP_COLOURS.edge);
  private readonly spriteNormal = new THREE.Vector3(0, 0, 1);
  private readonly flatFacing = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -Math.PI / 2,
  );
  private live = 0;
  private trailVertices = 0;

  constructor(private readonly deps: LevelUpVfxDeps) {
    this.texture = loadAtlasCell(2);
    const geometry = new THREE.PlaneGeometry(1, 1);

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      // The player and scenery occlude the far side of the orbit so it wraps around the body.
      depthTest: true,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, MAX_INSTANCES);
    this.mesh.name = "level-up-vfx";
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_INSTANCES * 3),
      3,
    );
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 12;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.deps.parent.add(this.mesh);

    this.trailGeometry = new THREE.BufferGeometry();
    const trailPosition = new THREE.BufferAttribute(this.trailPositions, 3);
    const trailColour = new THREE.BufferAttribute(this.trailColours, 3);
    trailPosition.setUsage(THREE.DynamicDrawUsage);
    trailColour.setUsage(THREE.DynamicDrawUsage);
    this.trailGeometry.setAttribute("position", trailPosition);
    this.trailGeometry.setAttribute("color", trailColour);
    this.trailGeometry.setDrawRange(0, 0);
    this.trailMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: true,
    });
    this.trailLines = new THREE.LineSegments(this.trailGeometry, this.trailMaterial);
    this.trailLines.name = "level-up-trails";
    this.trailLines.visible = false;
    this.trailLines.frustumCulled = false;
    this.trailLines.renderOrder = 13;
    this.deps.parent.add(this.trailLines);

    this.circleGeometry = new THREE.PlaneGeometry(1, 1);
    this.circleGeometry.rotateX(-Math.PI / 2);
    this.circleLayers = [
      { index: 13, size: 2.15, spin: 4.2, gain: 1.0, rise: 0.035 },
      { index: 14, size: 1.55, spin: -6.4, gain: 0.72, rise: 0.055 },
      { index: 12, size: 1.72, spin: 2.2, gain: 0.8, rise: 0.075 },
    ].map((spec) => {
      const texture = loadAtlasCell(spec.index);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: LEVEL_UP_COLOURS.core,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: true,
      });
      const mesh = new THREE.Mesh(this.circleGeometry, material);
      mesh.name = `level-up-circle-${spec.index}`;
      mesh.visible = false;
      mesh.renderOrder = 12;
      mesh.frustumCulled = false;
      this.deps.parent.add(mesh);
      return { mesh, texture, size: spec.size, spin: spec.spin, gain: spec.gain, rise: spec.rise };
    });
  }

  burst(nowMs: number, seed = Math.round(nowMs)): void {
    // Consecutive debug grants can overlap, but keeping only the latest two prevents an automated
    // XP jump from turning a celebration into a full-screen white block.
    if (this.bursts.length >= 2) this.bursts.shift();
    this.bursts.push({ bornAtMs: nowMs, seed: Math.imul(seed, 2654435761) >>> 0 });
  }

  update(nowMs: number): void {
    this.live = 0;
    this.trailVertices = 0;
    this.deps.camera.getWorldQuaternion(this.facing);
    let circlePhase = -1;

    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index]!;
      const rawAge = nowMs - burst.bornAtMs;
      if (rawAge >= LEVEL_UP_DURATION_MS) {
        this.bursts.splice(index, 1);
        continue;
      }
      // An event can land a few milliseconds after the timestamp supplied to the current rAF.
      // Keep that newborn burst for the next frame instead of deleting it as a clock mismatch.
      const age = Math.max(0, rawAge);
      const phase = age / LEVEL_UP_DURATION_MS;
      if (circlePhase < 0) circlePhase = phase;
      this.writeBurst(burst, phase);
    }

    this.updateCircles(circlePhase);

    this.mesh.count = this.live;
    this.mesh.visible = this.live > 0;
    if (this.live > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
    }
    this.trailGeometry.setDrawRange(0, this.trailVertices);
    this.trailLines.visible = this.trailVertices > 0;
    if (this.trailVertices > 0) {
      this.trailGeometry.getAttribute("position").needsUpdate = true;
      this.trailGeometry.getAttribute("color").needsUpdate = true;
    }
  }

  liveParticles(): number {
    return this.live;
  }

  activeBursts(): number {
    return this.bursts.length;
  }

  drawCalls(): number {
    return (this.mesh.visible ? 1 : 0)
      + (this.trailLines.visible ? 1 : 0)
      + this.circleLayers.filter((layer) => layer.mesh.visible).length;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.mesh.dispose();
    this.trailLines.removeFromParent();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
    for (const layer of this.circleLayers) {
      layer.mesh.removeFromParent();
      layer.mesh.material.dispose();
      layer.texture.dispose();
    }
    this.circleGeometry.dispose();
    this.bursts.length = 0;
    this.live = 0;
  }

  private writeBurst(burst: Burst, phase: number): void {
    const [x, y, z] = this.deps.playerPosition();
    const attack = Math.min(1, phase * 16);
    const release = Math.pow(1 - phase, 0.9);
    const envelope = attack * release;

    // Small bright heads rotate in two intertwined helices. Actual one-pixel line segments follow
    // each head, tapering toward black; this reads as a trail instead of a chain of oversized dots.
    for (let index = 0; index < ORBIT_HEAD_COUNT; index += 1) {
      const a = hash01(burst.seed, index, 1);
      const b = hash01(burst.seed, index, 2);
      const c = hash01(burst.seed, index, 3);
      const travel = fract(a + phase * (1.25 + b * 0.28));
      const angle = (index % 2) * Math.PI + a * TAU
        + phase * TAU * (1.45 + c * 0.35);
      const radius = 0.48 + b * 0.24 + Math.sin(travel * Math.PI) * 0.08;
      const sparkle = Math.sin(travel * Math.PI) * envelope;
      const size = 0.028 + b * 0.022;
      this.write(
        x + Math.cos(angle) * radius,
        y + 0.12 + travel * (1.75 + c * 0.35),
        z + Math.sin(angle) * radius,
        size,
        size * 1.45,
        angle + phase * 4,
        false,
        sparkle * 4.2,
        0.25 + 0.75 * c,
      );

      for (let trail = 0; trail < TRAIL_SEGMENTS; trail += 1) {
        this.writeTrailSegment(x, y, z, phase, index, trail, a, b, c, envelope);
      }
    }

    // A few independent pinpricks drift up through the orbit so the trails do not read as two
    // perfectly clean ribbons.
    for (let index = 0; index < RISING_SPARK_COUNT; index += 1) {
      const a = hash01(burst.seed, index, 4);
      const b = hash01(burst.seed, index, 5);
      const travel = fract(a + phase * (0.9 + b * 0.35));
      const angle = b * TAU + phase * TAU;
      this.write(
        x + Math.cos(angle) * (0.18 + a * 0.62),
        y + 0.1 + travel * 2.1,
        z + Math.sin(angle) * (0.18 + a * 0.62),
          0.018 + b * 0.014,
          0.026 + b * 0.022,
        angle,
        false,
        Math.sin(travel * Math.PI) * envelope * 2.7,
        0.55 + b * 0.45,
      );
    }
  }

  private updateCircles(phase: number): void {
    if (phase < 0) {
      for (const layer of this.circleLayers) layer.mesh.visible = false;
      return;
    }
    const [x, y, z] = this.deps.playerPosition();
    const envelope = Math.min(1, phase * 16) * Math.pow(1 - phase, 0.9);
    for (let index = 0; index < this.circleLayers.length; index += 1) {
      const layer = this.circleLayers[index]!;
      const expansion = index === 2 ? 1 + phase * 0.55 : 1 + Math.sin(phase * Math.PI) * 0.08;
      layer.mesh.position.set(x, y + layer.rise, z);
      layer.mesh.rotation.y = phase * layer.spin;
      layer.mesh.scale.setScalar(layer.size * expansion);
      layer.mesh.material.opacity = envelope * layer.gain;
      layer.mesh.visible = envelope > MIN_BRIGHTNESS;
    }
  }

  private writeTrailSegment(
    originX: number,
    originY: number,
    originZ: number,
    phase: number,
    head: number,
    trail: number,
    a: number,
    b: number,
    c: number,
    envelope: number,
  ): void {
    if (this.trailVertices + 2 > MAX_TRAIL_VERTICES) return;
    const firstPhase = Math.max(0, phase - trail * 0.026);
    const secondPhase = Math.max(0, phase - (trail + 1) * 0.026);
    if (firstPhase === secondPhase) return;

    for (let endpoint = 0; endpoint < 2; endpoint += 1) {
      const pointPhase = endpoint === 0 ? firstPhase : secondPhase;
      const travel = fract(a + pointPhase * (1.25 + b * 0.28));
      const angle = (head % 2) * Math.PI + a * TAU
        + pointPhase * TAU * (1.45 + c * 0.35);
      const radius = 0.48 + b * 0.24 + Math.sin(travel * Math.PI) * 0.08;
      const vertex = this.trailVertices;
      const offset = vertex * 3;
      this.trailPositions[offset] = originX + Math.cos(angle) * radius;
      this.trailPositions[offset + 1] = originY + 0.12 + travel * (1.75 + c * 0.35);
      this.trailPositions[offset + 2] = originZ + Math.sin(angle) * radius;

      const trailAge = trail + endpoint;
      const taper = Math.pow(1 - trailAge / (TRAIL_SEGMENTS + 1), 1.8);
      const brightness = Math.sin(travel * Math.PI) * envelope * taper * 3.0;
      this.colour.copy(this.core).lerp(this.edge, 0.25 + 0.75 * c).multiplyScalar(brightness);
      this.trailColours[offset] = this.colour.r;
      this.trailColours[offset + 1] = this.colour.g;
      this.trailColours[offset + 2] = this.colour.b;
      this.trailVertices += 1;
    }
  }

  private write(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    roll: number,
    flat: boolean,
    brightness: number,
    colourMix: number,
  ): void {
    if (brightness <= MIN_BRIGHTNESS || this.live >= MAX_INSTANCES) return;
    const slot = this.live;

    this.position.set(x, y, z);
    this.scale.set(width, height, 1);
    const base = flat ? this.flatFacing : this.facing;
    if (roll === 0) this.orient.copy(base);
    else {
      this.spin.setFromAxisAngle(this.spriteNormal, roll);
      this.orient.copy(base).multiply(this.spin);
    }
    this.matrix.compose(this.position, this.orient, this.scale);
    this.mesh.setMatrixAt(slot, this.matrix);

    const light = brightness * 1.8;
    this.colour.copy(this.core).lerp(this.edge, colourMix).multiplyScalar(light);
    this.mesh.setColorAt(slot, this.colour);
    this.live = slot + 1;
  }
}

function loadAtlasCell(index: number): THREE.Texture {
  const texture = typeof document === "undefined"
    ? new THREE.Texture()
    : new THREE.TextureLoader().load(atlasUrl(), undefined, undefined, (error: unknown) => {
      console.error(`[levelUpVfx] magic atlas failed to load from ${atlasUrl()}.`, error);
    });
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // Crop one Magic Effects FREE cell with Three's stock UV transform. Separate circle layers use
  // the rune, glyph and ring cells; the instanced trail layer uses the soft spark cell.
  texture.repeat.set(1 / ATLAS_GRID, 1 / ATLAS_GRID);
  texture.offset.set(index % ATLAS_GRID / ATLAS_GRID, (ATLAS_GRID - 1 - Math.floor(index / ATLAS_GRID)) / ATLAS_GRID);
  return texture;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function hash01(seed: number, index: number, salt: number): number {
  let hash = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97) >>> 0;
  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
}
