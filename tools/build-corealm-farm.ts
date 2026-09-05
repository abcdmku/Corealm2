/** Original farm geometry. Stage only: npx tsx tools/build-corealm-farm.ts --out test-results/farm-props */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Document, NodeIO, type Material } from "@gltf-transform/core";
import { KHRMaterialsIOR, KHRMaterialsTransmission, KHRMaterialsVolume } from "@gltf-transform/extensions";
import { copyToDocument, weld } from "@gltf-transform/functions";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { AssetEntry } from "../game/src/render/assets.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRECTORY = "models/corealm/farm";
const MATERIAL_SOURCE = "game/public/assets/models/prop/training_dummy.glb";
export const FARM_ASSET_IDS = ["corealm_scarecrow", "corealm_feed_trough", "corealm_water_trough"] as const;
export type FarmAssetId = typeof FARM_ASSET_IDS[number];
type Role = "timber" | "cloth" | "sack" | "hat" | "straw" | "thread" | "iron" | "water";
type Point = [number, number, number];
type Part = { name: string; role: Role; geometry: THREE.BufferGeometry };
export interface FarmAssetEntry extends AssetEntry { sha256: string; triangles: number; parts: string[] }
const NAMES: Record<Role, string> = {
  timber: "Corealm farm timber", cloth: "Corealm farm cloth", sack: "Corealm farm sacking",
  hat: "Corealm farm felt", straw: "Corealm farm straw", thread: "Corealm farm thread",
  iron: "Corealm farm iron", water: "Corealm farm water",
};
const PACK = {
  id: "corealm-original-farm", name: "Corealm farmyard tools and scarecrow", author: "Corealm",
  source: "tools/build-corealm-farm.ts",
  license: "Original project geometry. Existing Fantasy Props Megakit material maps retain their source pack license.",
};
const v = (point: Point): THREE.Vector3 => new THREE.Vector3(...point);
const random = (index: number, seed = 0): number => {
  const value = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453123;
  return value - Math.floor(value);
};

class FarmModel {
  readonly parts: Part[] = [];

  add(name: string, role: Role, geometry: THREE.BufferGeometry, colour = 0xffffff, tone = 1): void {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (source !== geometry) geometry.dispose();
    const position = source.getAttribute("position");
    const uv = source.getAttribute("uv");
    const colors: number[] = [];
    const base = new THREE.Color(colour);
    for (let i = 0; i < position.count; i++) {
      const wear = tone * (0.97 + 0.025 * Math.sin(position.getX(i) * 9.3 + position.getY(i) * 5.1 + position.getZ(i) * 7.7));
      colors.push(base.r * wear, base.g * wear, base.b * wear);
      // Islands stay inside the shared atlas's plain plank/fabric bands. Geometry,
      // not an atlas illustration, supplies every edge, fold, stave and seam.
      if (role === "timber") uv.setXY(i, 0.045 + uv.getX(i) * 0.90, 0.225 + uv.getY(i) * 0.16);
      if (role === "cloth" || role === "sack" || role === "hat") {
        uv.setXY(i, 0.055 + uv.getX(i) * 0.13, 0.16 + uv.getY(i) * 0.26);
      }
    }
    source.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    source.clearGroups();
    this.parts.push({ name, role, geometry: source });
  }

  tube(name: string, role: Role, points: Point[], radius: number, colour = 0xffffff, sides = 8): void {
    const curve = new THREE.CatmullRomCurve3(points.map(v));
    this.add(name, role, new THREE.TubeGeometry(curve, Math.max(4, (points.length - 1) * 5), radius, sides, false), colour);
  }

  beam(name: string, a: Point, b: Point, width: number, depth: number, colour = 0xb7b2a4): void {
    const start = v(a), end = v(b), direction = end.clone().sub(start);
    const geometry = new RoundedBoxGeometry(width, direction.length(), depth, 3, Math.min(width, depth) * 0.14);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    geometry.translate(...start.add(end).multiplyScalar(0.5).toArray());
    this.add(name, "timber", geometry, colour);
  }

  fit(size: Point): void {
    const bounds = new THREE.Box3();
    for (const part of this.parts) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox!); }
    const scale = v(size).divide(bounds.getSize(new THREE.Vector3()));
    const centre = bounds.getCenter(new THREE.Vector3());
    for (const part of this.parts) {
      part.geometry.translate(-centre.x, -bounds.min.y, -centre.z).scale(scale.x, scale.y, scale.z);
      part.geometry.computeBoundingBox();
    }
  }
}

/** Curved textile/wood strips retain smooth normals and real edge thickness where needed. */
function surface(nu: number, nv: number, point: (u: number, t: number) => Point, flip = false): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    positions.push(...point(i / nu, j / nv)); uvs.push(i / nu, j / nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    indices.push(...(flip ? [a, c, b, b, c, d] : [a, b, c, b, d, c]));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function turnedProfile(points: THREE.Vector2[], depth: number, bevel = 0.006): THREE.BufferGeometry {
  const shape = new THREE.Shape(points);
  shape.closePath();
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2, steps: 1, bevelEnabled: true, bevelSegments: 3,
    bevelSize: bevel, bevelThickness: bevel, curveSegments: 16,
  }).translate(0, 0, -depth / 2 + bevel).rotateY(Math.PI / 2);
  const geometry = toCreasedNormals(raw, Math.PI / 3);
  if (geometry !== raw) raw.dispose();
  // Each physical plank gets one grain island aligned along its length.
  const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, extent = bounds.getSize(new THREE.Vector3());
  for (let offset = 0; offset < position.count; offset += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, offset);
    const b = new THREE.Vector3().fromBufferAttribute(position, offset + 1).sub(a);
    const c = new THREE.Vector3().fromBufferAttribute(position, offset + 2).sub(a);
    const normal = b.cross(c).normalize();
    for (let corner = 0; corner < 3; corner++) {
      const i = offset + corner;
      if (Math.abs(normal.x) > Math.max(Math.abs(normal.y), Math.abs(normal.z))) {
        uv.setXY(i, (position.getZ(i) - bounds.min.z) / extent.z, (position.getY(i) - bounds.min.y) / extent.y);
      } else {
        uv.setXY(i, (position.getX(i) - bounds.min.x) / extent.x,
          Math.abs(normal.y) > Math.abs(normal.z) ? (position.getZ(i) - bounds.min.z) / extent.z
            : (position.getY(i) - bounds.min.y) / extent.y);
      }
    }
  }
  return geometry;
}

function scarecrow(): FarmModel {
  const model = new FarmModel();
  model.tube("leaning-support-pole", "timber", [[0, 0, 0], [0.022, 0.6, -0.012], [0.075, 1.26, -0.04], [0.11, 1.87, -0.055]], 0.046, 0xbab4a0, 14);
  model.tube("unequal-crossarm", "timber", [[-0.87, 1.39, -0.045], [-0.4, 1.46, -0.04], [0.06, 1.45, -0.04], [0.84, 1.32, -0.025]], 0.03, 0xbcb29a, 12);
  const torso = (u: number, t: number, outward = 0): Point => {
    const angle = u * Math.PI * 2;
    const width = 0.26 + 0.022 * Math.sin(t * Math.PI) - 0.105 * Math.max(0, (t - 0.73) / 0.27);
    const hem = (1 - t) ** 9 * (0.028 * Math.sin(angle * 5) + 0.035 * Math.sin(angle * 9 + 1));
    const fold = 0.012 * Math.sin(angle * 9 + t * 3) * (0.6 + 0.4 * Math.sin(t * Math.PI));
    return [0.035 + Math.cos(angle) * (width + fold + outward), 0.82 + t * 0.71 + hem,
      Math.sin(angle) * (0.132 + 0.035 * Math.sin(t * Math.PI) + fold + outward) + 0.035];
  };
  model.add("folded-open-tunic", "cloth", surface(64, 28, (u, t) => torso(u, t), true), 0x74867a);
  // A second inset hem ring gives the torn cloth a physical edge instead of a cutout card.
  model.add("turned-tunic-hem", "cloth", surface(64, 2, (u, t) => {
    const outer = torso(u, t * 0.04); return [outer[0] * (0.965 + t * 0.035), outer[1], outer[2] * (0.965 + t * 0.035)];
  }), 0x596c61);
  for (const side of [-1, 1]) {
    const sleeve = (u: number, t: number): Point => {
      const angle = u * Math.PI * 2;
      const radius = 0.118 - t * 0.025 + Math.sin(t * Math.PI * 4.5) * 0.008;
      return [0.035 + side * (0.17 + t * 0.58), 1.43 - t * (side < 0 ? 0.085 : 0.17)
        + Math.cos(angle) * radius - Math.sin(t * Math.PI) * 0.032,
      0.035 + Math.sin(angle) * radius * 0.82];
    };
    model.add(`drooping-sleeve-${side}`, "cloth", surface(40, 20, sleeve, side < 0), 0x738479);
    model.tube(`rolled-cuff-${side}`, "cloth", Array.from({ length: 25 }, (_, i) => sleeve(i / 24, 0.96)), 0.012, 0xa6a397);
    for (let stalk = 0; stalk < 30; stalk++) {
      const angle = random(stalk, side) * Math.PI * 2, spread = 0.06 * Math.sqrt(random(stalk, 11));
      const start: Point = [0.035 + side * 0.72, 1.43 - (side < 0 ? 0.085 : 0.17) + Math.cos(angle) * spread, 0.035 + Math.sin(angle) * spread];
      const end: Point = [start[0] + side * (0.06 + random(stalk, 7) * 0.15), start[1] + (random(stalk, 2) - 0.5) * 0.12, start[2] + (random(stalk, 3) - 0.5) * 0.10];
      model.tube(`straw-cuff-${side}-${stalk}`, "straw", [start, [(start[0] + end[0]) / 2, start[1] + 0.01, start[2]], end], 0.0033, stalk % 3 ? 0xb9a16b : 0xd0bb83, 5);
    }
  }
  for (let stalk = 0; stalk < 44; stalk++) {
    const u = random(stalk, 81), start = torso(u, 0.08), end = torso(u, 0);
    end[1] -= 0.025 + random(stalk, 82) * 0.12;
    model.tube(`straw-hem-${stalk}`, "straw", [start, [end[0], end[1] + 0.08, end[2]], end], 0.0028, 0xbcaa76, 5);
  }
  const head = new THREE.SphereGeometry(1, 40, 28).scale(0.157, 0.205, 0.137).rotateZ(-0.085).translate(0.055, 1.696, 0.027);
  model.add("wrinkled-sack-head", "sack", head, 0xb5aa8b);
  model.tube("gathered-neck-cord", "thread", Array.from({ length: 33 }, (_, i) => {
    const a = i / 32 * Math.PI * 2; return [0.04 + Math.cos(a) * 0.111, 1.526 + Math.sin(a * 3) * 0.005, 0.03 + Math.sin(a) * 0.088];
  }), 0.006, 0xa68d63);
  // Small dark crossed thread eyes and an uneven stitched mouth stay on the sack face.
  for (const eyeX of [-0.003, 0.106]) for (const diagonal of [-1, 1]) {
    model.tube(`stitched-eye-${eyeX}-${diagonal}`, "thread", [[eyeX - 0.014, 1.714 - diagonal * 0.014, 0.159], [eyeX, 1.714, 0.169], [eyeX + 0.014, 1.714 + diagonal * 0.014, 0.159]], 0.0033, 0x484338, 6);
  }
  for (let stitch = 0; stitch < 8; stitch++) {
    const x = -0.016 + stitch * 0.019, y = 1.615 + (x - 0.05) ** 2 * 1.3;
    model.tube(`stitched-mouth-${stitch}`, "thread", [[x, y - 0.004, 0.151], [x + 0.011, y + 0.005, 0.154]], 0.0026, 0x4d4437, 5);
  }
  // Cloth patches follow the actual folded tunic; stitches cross their hem at 15mm spacing.
  for (const [patch, u0, t0, du, dt] of [[0, 0.17, 0.16, 0.09, 0.22], [1, 0.31, 0.53, 0.075, 0.18]]) {
    const patchPoint = (u: number, t: number): Point => torso(u0! + u * du!, t0! + t * dt!, 0.006);
    model.add(`sewn-patch-${patch}`, "cloth", surface(14, 12, patchPoint, true), patch ? 0x948372 : 0xa8a18a);
    for (let stitch = 0; stitch <= 9; stitch++) for (const edge of [0, 1]) {
      model.tube(`patch-${patch}-stitch-h-${edge}-${stitch}`, "thread", [patchPoint(stitch / 10, edge), patchPoint((stitch + 0.45) / 10, edge ? 0.94 : 0.06)], 0.0027, 0xcdbea0, 5);
      model.tube(`patch-${patch}-stitch-v-${edge}-${stitch}`, "thread", [patchPoint(edge, stitch / 10), patchPoint(edge ? 0.94 : 0.06, (stitch + 0.45) / 10)], 0.0027, 0xcdbea0, 5);
    }
  }
  for (let stitch = 0; stitch < 28; stitch++) {
    model.tube(`front-placket-stitch-${stitch}`, "thread", [torso(0.245, 0.10 + stitch * 0.028, 0.006), torso(0.255, 0.115 + stitch * 0.028, 0.006)], 0.0026, 0xbdbaa1, 5);
  }
  const brim = (u: number, t: number): Point => {
    const angle = u * Math.PI * 2, radius = 0.12 + t * 0.175;
    return [0.04 + Math.cos(angle) * radius, 1.835 - radius * 0.14 + Math.sin(angle * 2 + 1) * t * 0.031,
      0.025 + Math.sin(angle) * radius * 0.9];
  };
  model.add("soft-sagging-hat-brim", "hat", surface(64, 12, brim), 0x615c4c);
  model.tube("bound-hat-brim", "hat", Array.from({ length: 65 }, (_, i) => brim(i / 64, 1)), 0.009, 0x8b8168);
  const crown = surface(48, 16, (u, t) => {
    const a = u * Math.PI * 2, r = 0.142 - t * 0.035 + Math.sin(t * Math.PI) * 0.010;
    return [0.04 + Math.cos(a) * r - t * 0.025, 1.816 + t * 0.17 + Math.sin(a * 3) * 0.007 * t,
      0.025 + Math.sin(a) * r * 0.9];
  }, true);
  model.add("creased-felt-hat-crown", "hat", crown, 0x68624f);
  model.add("closed-hat-crown", "hat", new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2)
    .scale(0.107, 0.025, 0.096).translate(0.015, 1.984, 0.025), 0x68624f);
  model.tube("hat-band", "cloth", Array.from({ length: 49 }, (_, i) => {
    const a = i / 48 * Math.PI * 2; return [0.035 + Math.cos(a) * 0.143, 1.849 + Math.sin(a * 3) * 0.002, 0.025 + Math.sin(a) * 0.129];
  }), 0.011, 0x9d8c6a);
  // Visible winding binds the crossarm to the stake on the back of the shirt.
  for (let loop = 0; loop < 5; loop++) {
    model.tube(`crossarm-lashing-${loop}`, "thread", [[-0.015 + loop * 0.017, 1.40, -0.106], [0.04 + loop * 0.011, 1.49, -0.084], [0.10 + loop * 0.01, 1.47, -0.063]], 0.004, 0xb3a17b, 6);
  }
  model.fit([1.65, 1.95, 0.58]);
  return model;
}

function trough(fill: "feed" | "water"): FarmModel {
  const model = new FarmModel();
  const shell = (angle: number, inset = 0): THREE.Vector2 => new THREE.Vector2(
    Math.cos(angle) * (0.35 - inset), 0.706 - Math.sin(angle) * (0.373 - inset));
  for (let stave = 0; stave < 11; stave++) {
    const a = stave / 11 * Math.PI + 0.006, b = (stave + 1) / 11 * Math.PI - 0.006;
    const outline = [
      ...Array.from({ length: 7 }, (_, i) => shell(a + (b - a) * i / 6)),
      ...Array.from({ length: 7 }, (_, i) => shell(b - (b - a) * i / 6, 0.05)),
    ];
    model.add(`curved-hull-stave-${stave}`, "timber", turnedProfile(outline, 1.36, 0.004), 0xb1ada1, 0.91 + stave % 4 * 0.025);
  }
  // Solid end boards seal the hollow curved shell; the top stays open.
  const endOutline = Array.from({ length: 25 }, (_, i) => shell(i / 24 * Math.PI, 0.009));
  for (const side of [-1, 1]) {
    model.add(`sealed-end-board-${side}`, "timber", turnedProfile(endOutline, 0.055).translate(side * 0.658, 0, 0), 0xb1aaa0);
    model.tube(`worn-long-rim-${side}`, "timber", [[-0.69, 0.717, side * 0.351], [-0.36, 0.714, side * 0.354], [0.24, 0.72, side * 0.354], [0.69, 0.717, side * 0.351]], 0.026, 0xc2baa6, 14);
    model.tube(`worn-end-rim-${side}`, "timber", [[side * 0.66, 0.718, -0.35], [side * 0.665, 0.725, 0], [side * 0.66, 0.718, 0.35]], 0.026, 0xc2baa6, 14);
  }
  for (const x of [-0.465, 0.465]) {
    for (const side of [-1, 1]) {
      model.beam(`splayed-foot-${x}-${side}`, [x, 0.057, side * 0.29], [x, 0.404, side * 0.18], 0.106, 0.11);
      model.beam(`knee-brace-${x}-${side}`, [x, 0.15, side * 0.055], [x, 0.348, side * 0.264], 0.059, 0.072, 0xaaa597);
    }
    model.beam(`trestle-crossbar-${x}`, [x, 0.16, -0.325], [x, 0.16, 0.325], 0.11, 0.096);
    const outline = [
      ...Array.from({ length: 33 }, (_, i) => shell(i / 32 * Math.PI, -0.013)),
      ...Array.from({ length: 33 }, (_, i) => shell((32 - i) / 32 * Math.PI, -0.005)),
    ];
    model.add(`forged-underbelly-hoop-${x}`, "iron", turnedProfile(outline, 0.043, 0.002).translate(x, 0, 0), 0x666861);
    for (const side of [-1, 1]) {
      model.add(`rim-hoop-rivet-${x}-${side}`, "iron", new THREE.SphereGeometry(0.012, 12, 8).scale(1, 1, 0.44)
        .translate(x, 0.672, side * 0.365), 0xa2a097);
    }
  }
  model.beam("longitudinal-trestle-tie", [-0.49, 0.157, 0], [0.49, 0.157, 0], 0.065, 0.084);
  if (fill === "feed") {
    // The old bed sat 25cm under the front lip, entirely occluded at the lab's
    // approach camera. Keep a visible shallow mound 6-12cm below the lip instead.
    const feedY = (x: number, z: number): number => 0.599 + 0.036 * Math.cos(x * 3.2) * Math.cos(z * 5.5)
      + Math.sin(x * 23 + z * 31) * 0.010 + Math.cos(x * 37 - z * 18) * 0.005;
    model.add("low-feed-bed", "straw", surface(64, 28, (u, t) => {
      const x = (u - 0.5) * 1.19, z = (t - 0.5) * 0.55;
      return [x, feedY(x, z), z];
    }, true), 0xb9a273);
    for (let seed = 0; seed < 180; seed++) {
      const x = (random(seed, 42) - 0.5) * 1.16, z = (random(seed, 43) - 0.5) * 0.51;
      model.add(`oat-grain-${seed}`, "straw", new THREE.SphereGeometry(1, 8, 5)
        .scale(0.008, 0.006, 0.017).rotateY(random(seed, 4) * Math.PI).translate(x, feedY(x, z) + 0.005, z),
      seed % 4 ? 0xd0bb83 : 0xa58a51);
    }
    for (let stem = 0; stem < 85; stem++) {
      const x = (random(stem, 55) - 0.5) * 1.06, z = (random(stem, 56) - 0.5) * 0.44;
      const dx = (random(stem, 57) - 0.5) * 0.12, dz = (random(stem, 58) - 0.5) * 0.08;
      model.tube(`feed-chaff-${stem}`, "straw", [[x, feedY(x, z) + 0.003, z], [x + dx / 2, feedY(x, z) + 0.014, z + dz / 2], [x + dx, feedY(x + dx, z + dz) + 0.003, z + dz]], 0.003, 0xd2bd88, 5);
    }
  } else {
    // Crossed capillary waves and one diminishing circular disturbance tilt the
    // actual surface normals enough for reflected sky and refracted timber to move.
    const waterPoint = (u: number, t: number, bottom = false): Point => {
      const x = (u - 0.5) * 1.235, z = (t - 0.5) * 0.544;
      if (bottom) return [x, 0.708 - Math.sqrt(1 - (z / 0.30) ** 2) * 0.323, z];
      const radius = Math.hypot(x + 0.24, z - 0.07);
      const capillary = Math.sin(x * 37 + z * 22) * 0.0023 + Math.sin(x * 17 - z * 46) * 0.0017;
      const ring = Math.cos(radius * 81) * Math.exp(-radius * 3.8) * 0.0028;
      const meniscus = (Math.abs(2 * u - 1) ** 18 + Math.abs(2 * t - 1) ** 18) * 0.0018;
      return [x, 0.599 + capillary + ring + meniscus, z];
    };
    model.add("inset-waterline", "water", surface(112, 48, waterPoint, true), 0xf5fbf7);
    // Close the water volume against the actual curved basin before assigning
    // physical thickness/absorption. The optical volume is never an open plane.
    model.add("water-volume-bottom", "water", surface(112, 48, (u, t) => waterPoint(u, t, true)), 0xf5fbf7);
    for (const side of [0, 1]) {
      model.add(`water-volume-long-edge-${side}`, "water", surface(112, 1, (u, t) =>
        v(waterPoint(u, side, true)).lerp(v(waterPoint(u, side)), t).toArray(), side === 0), 0xf5fbf7);
      model.add(`water-volume-end-${side}`, "water", surface(48, 1, (u, t) =>
        v(waterPoint(side, u, true)).lerp(v(waterPoint(side, u)), t).toArray(), side === 1), 0xf5fbf7);
    }
  }
  // Both fills remain strictly inside the same hull bounds, so this shared fit
  // grounds and sizes the two hulls identically. Focused tests compare their bytes.
  model.fit([1.4, 0.76, 0.76]);
  return model;
}

/** In-memory source geometry, grouped by authored role for focused geometry checks. */
export function buildFarmGeometry(assetId: FarmAssetId): THREE.Group {
  if (!FARM_ASSET_IDS.includes(assetId)) throw new Error(`Unknown Corealm farm asset: ${assetId}`);
  const model = assetId === "corealm_scarecrow" ? scarecrow() : trough(assetId === "corealm_feed_trough" ? "feed" : "water");
  const group = new THREE.Group(); group.name = assetId;
  for (const part of model.parts) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: part.role === "water" ? 0.17 : 0.9 });
    material.name = NAMES[part.role];
    material.side = ["cloth", "hat"].includes(part.role) ? THREE.DoubleSide : THREE.FrontSide;
    const mesh = new THREE.Mesh(part.geometry, material); mesh.name = part.name; mesh.userData.farmRole = part.role;
    group.add(mesh);
  }
  return group;
}

let sourceMaterialPromise: Promise<Document> | undefined;
const io = new NodeIO().registerExtensions([KHRMaterialsIOR, KHRMaterialsTransmission, KHRMaterialsVolume]);
async function materialSet(document: Document): Promise<Map<Role, Material>> {
  sourceMaterialPromise ??= io.read(path.join(ROOT, MATERIAL_SOURCE));
  const source = await sourceMaterialPromise;
  const originals = source.getRoot().listMaterials();
  const copied = copyToDocument(document, source, originals);
  const byName = new Map(originals.map(material => [material.getName(), copied.get(material) as Material]));
  const wood = byName.get("MI_Trim_Furniture")!, cloth = byName.get("MI_Trim_Cloth")!, metal = byName.get("MI_Trim_Metal")!;
  const result = new Map<Role, Material>();
  result.set("timber", wood.setName(NAMES.timber).setMetallicFactor(0).setRoughnessFactor(0.94).setNormalScale(0.65));
  for (const role of ["cloth", "sack", "hat"] as const) {
    const material = role === "cloth" ? cloth : cloth.clone();
    result.set(role, material.setName(NAMES[role]).setMetallicFactor(0).setRoughnessFactor(1).setNormalScale(0.8).setDoubleSided(true));
  }
  // Slim forged fittings use an explicit authored metal response. Trim atlas areas
  // are unsuitable for their tiny continuous UVs, so they keep no copied images.
  result.set("iron", metal.setName(NAMES.iron).setBaseColorTexture(null).setNormalTexture(null)
    .setMetallicRoughnessTexture(null).setMetallicFactor(0.62).setRoughnessFactor(0.5));
  for (const role of ["straw", "thread", "water"] as const) {
    result.set(role, document.createMaterial(NAMES[role]).setBaseColorFactor([1, 1, 1, 1])
      .setMetallicFactor(0).setRoughnessFactor(role === "water" ? 0.16 : 0.95));
  }
  return result;
}

export async function buildFarmAsset(assetId: FarmAssetId): Promise<{ glb: Uint8Array; entry: FarmAssetEntry }> {
  const group = buildFarmGeometry(assetId), document = new Document(), buffer = document.createBuffer();
  const materials = await materialSet(document), scene = document.createScene(assetId);
  if (assetId === "corealm_water_trough") {
    const material = materials.get("water")!;
    material.setName("Corealm farm water@capillary-transmission-v2").setRoughnessFactor(0.085)
      .setBaseColorFactor([0.91, 0.96, 0.93, 1]).setEmissiveFactor([0, 0, 0])
      .setExtras({ entityCastShadow: false });
    material.setExtension("KHR_materials_ior", document.createExtension(KHRMaterialsIOR).createIOR().setIOR(1.333));
    material.setExtension("KHR_materials_transmission", document.createExtension(KHRMaterialsTransmission)
      .createTransmission().setTransmissionFactor(0.94));
    material.setExtension("KHR_materials_volume", document.createExtension(KHRMaterialsVolume)
      .createVolume().setThicknessFactor(0.12).setAttenuationDistance(0.9).setAttenuationColor([0.68, 0.82, 0.73]));
  }
  document.getRoot().setDefaultScene(scene);
  const roles = [...new Set(group.children.map(child => child.userData.farmRole as Role))];
  const names = group.children.map(child => child.name);
  let triangles = 0;
  for (const role of roles) {
    const members = group.children.filter(child => child.userData.farmRole === role) as THREE.Mesh[];
    const geometry = mergeGeometries(members.map(member => member.geometry), false)!;
    const primitive = document.createPrimitive().setMaterial(materials.get(role)!);
    for (const [source, target, type] of [["position", "POSITION", "VEC3"], ["normal", "NORMAL", "VEC3"], ["color", "COLOR_0", "VEC3"], ["uv", "TEXCOORD_0", "VEC2"]] as const) {
      primitive.setAttribute(target, document.createAccessor(`${role}-${source}`).setType(type)
        .setArray(new Float32Array(geometry.getAttribute(source).array)).setBuffer(buffer));
    }
    triangles += geometry.getAttribute("position").count / 3;
    scene.addChild(document.createNode(`${assetId}-${role}`).setMesh(document.createMesh(`${assetId}-${role}`).addPrimitive(primitive)));
    geometry.dispose();
  }
  for (const [role, material] of materials) if (!roles.includes(role)) material.dispose();
  const usedTextures = new Set(document.getRoot().listMaterials().flatMap(material => [material.getBaseColorTexture(), material.getNormalTexture(), material.getMetallicRoughnessTexture()]));
  for (const texture of document.getRoot().listTextures()) if (!usedTextures.has(texture)) texture.dispose();
  await document.transform(weld());
  const bounds = new THREE.Box3().setFromObject(group), size = bounds.getSize(new THREE.Vector3());
  const glb = await io.writeBinary(document);
  for (const child of group.children as THREE.Mesh[]) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
  const rounded = (value: number): number => Number(value.toFixed(6));
  return { glb, entry: {
    id: assetId, file: `${DIRECTORY}/${assetId}.glb`, pack: PACK.id, category: "farm",
    is: assetId === "corealm_scarecrow" ? "scarecrow" : "trough",
    tags: ["farm", "corealm", "original-geometry", ...(assetId === "corealm_scarecrow" ? ["scarecrow", "straw", "cloth"] : ["trough", assetId === "corealm_feed_trough" ? "feed" : "water", "timber"])],
    bytes: glb.byteLength, size: { x: rounded(size.x), y: rounded(size.y), z: rounded(size.z) },
    base: { x: rounded(bounds.min.x), y: rounded(bounds.min.y), z: rounded(bounds.min.z) },
    animations: [], materials: roles.map(role => materials.get(role)!.getName()), triangles, parts: names,
    sha256: createHash("sha256").update(glb).digest("hex"),
  } };
}

export function farmOutputPaths(out = "test-results/farm-props"): { root: string; models: string; catalog: string } {
  const staging = path.resolve(ROOT, "test-results"), directory = path.resolve(ROOT, out), relative = path.relative(staging, directory);
  if (!out.trim() || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Farm output must stay inside test-results");
  }
  return { root: directory, models: path.join(directory, DIRECTORY), catalog: path.join(directory, "corealm-farm.json") };
}

export async function buildCorealmFarm(out?: string, troughsOnly = false): Promise<{ entries: FarmAssetEntry[]; paths: ReturnType<typeof farmOutputPaths> }> {
  const paths = farmOutputPaths(out), entries: FarmAssetEntry[] = [];
  if (troughsOnly) {
    const existing = JSON.parse(await readFile(paths.catalog, "utf8")) as { assets: FarmAssetEntry[] };
    const scarecrow = existing.assets.find(entry => entry.id === "corealm_scarecrow");
    if (!scarecrow) throw new Error("Trough-only staging requires the accepted scarecrow catalogue entry");
    const bytes = await readFile(path.join(paths.models, "corealm_scarecrow.glb"));
    if (createHash("sha256").update(bytes).digest("hex") !== scarecrow.sha256) throw new Error("Accepted staged scarecrow no longer matches its catalogue");
    entries.push(scarecrow);
  }
  await mkdir(paths.models, { recursive: true });
  for (const id of FARM_ASSET_IDS.filter(id => !troughsOnly || id !== "corealm_scarecrow")) {
    const { entry, glb } = await buildFarmAsset(id);
    await writeFile(path.join(paths.models, `${id}.glb`), glb); entries.push(entry);
    console.log(`${id}: ${entry.triangles} triangles, ${JSON.stringify(entry.size)}, ${Math.round(glb.byteLength / 1024)} KiB`);
  }
  const source = await sourceMaterialPromise!;
  const textureProvenance = source.getRoot().listTextures().filter(texture => /d2aebd|e76ee1|598907|d8c9f4|723e01|4007f6/.test(texture.getURI()))
    .map(texture => ({ source: texture.getURI(), sha256: createHash("sha256").update(texture.getImage()!).digest("hex") }));
  await writeFile(paths.catalog, `${JSON.stringify({
    pack: PACK, generator: "npx tsx tools/build-corealm-farm.ts --out test-results/farm-props",
    generatorSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
    coordinates: "Native metres, Y up, centred XZ. Scarecrow face +Z; trough long axis X. Place at existing 1.15 scarecrow and 1.1/1.15 trough scales.",
    construction: "Original folded clothing with sewn patches and crossed thread stitches, a soft creased felt hat and individual straw stalks over a leaning wooden armature. Trough uses eleven separate curved staves, sealed end boards, worn rounded lips, two forged belly hoops, splayed braced trestles and a longitudinal tie. Uneven grain and chopped straw sit below the lip at a readable height. The water state uses geometric capillary waves, physical transmission, water IOR and shallow absorption in the same hollow hull.",
    materialDependency: { pack: "fantasy-props-megakit", sourceAsset: MATERIAL_SOURCE, note: "Only existing plank and fabric PBR images are reused byte-for-byte. All mesh geometry and UV islands are original; image source licenses remain unchanged.", textures: textureProvenance },
    assets: entries,
  }, null, 2)}\n`);
  return { entries, paths };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const troughsOnly = args.includes("--troughs-only"), paths = args.filter(arg => arg !== "--troughs-only");
  if (paths.length && (paths.length !== 2 || paths[0] !== "--out" || !paths[1]?.trim())) throw new Error("Usage: build-corealm-farm.ts [--out test-results/farm-props] [--troughs-only]");
  await buildCorealmFarm(paths[1], troughsOnly);
}
