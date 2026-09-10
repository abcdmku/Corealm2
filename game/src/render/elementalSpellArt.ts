import * as THREE from "three";
import type { Vec3, SpellElement } from "../contracts.js";
import type {
  ElementalCast,
  ElementalPulse,
} from "../systems/elementalAttacks.js";
import { ELEMENTAL_ENERGY } from "./elementalEnergyStyles.js";
import { ElementalEnergyBodies } from "./elementalEnergyBodies.js";
import { elementalSpell } from "../content/elementalSpells.js";
import type { PulseArt } from "./elementalPulseArt.js";

const TAU = Math.PI * 2;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};

/** Authored principal shapes. Fine particles and small sparks remain in the companion VFX layer. */
export class ElementalSpellArt {
  private bodies: ElementalEnergyBodies;
  private readonly batches: Record<SpellElement,ElementalEnergyBodies>;
  private palette = ELEMENTAL_ENERGY["air-needle"];
  constructor(
    parent: THREE.Object3D,
    private readonly ground: (x: number, z: number) => number,
  ) {
    this.batches = {
      earth: new ElementalEnergyBodies(parent),
      wind: new ElementalEnergyBodies(parent,"wind"),
      water: new ElementalEnergyBodies(parent,"water",true),
      fire: new ElementalEnergyBodies(parent,"fire"),
    };
    this.bodies = this.batches.earth;
  }
  get instances(): number {
    return this.bodies.instances;
  }
  get dropped(): number {
    return this.bodies.dropped;
  }
  begin(seconds: number, cast: ElementalCast | null): void {
    for (const batch of Object.values(this.batches)) batch.begin(seconds);
    if (cast) {
      this.palette = ELEMENTAL_ENERGY[cast.spellId];
      this.bodies = this.batches[elementalSpell(cast.spellId).element];
    }
  }
  end(): void {
    for (const batch of Object.values(this.batches)) batch.end();
  }
  dispose(): void {
    for (const batch of Object.values(this.batches)) batch.dispose();
  }
  projectile(
    p: ElementalPulse,
    t: number,
    start: Vec3,
    delta: Vec3,
    arc: number,
    element: SpellElement,
    seed: number,
    variant?: PulseArt,
  ): void {
    const fade = 1 - ease((t - 1) / 0.24),
      pal = this.palette,
      head = clamp(t),
      tail = Math.max(0, t - (p.form === "meteor" ? 0.48 : 0.4));
    if (head <= tail || fade < 0.01) return;
    const length = Math.hypot(delta[0], delta[2]) || 1,
      dx = delta[0] / length,
      dz = delta[2] / length,
      px = dz,
      pz = -dx;
    const point = (u: number, side = 0, up = 0): Vec3 => [
      start[0] + delta[0] * u + px * (side+Math.sin(u*Math.PI)*(variant?.bend??0)),
      start[1] + delta[1] * u + Math.sin(u * Math.PI) * (arc+(variant?.lift??0)*.35) + up,
      start[2] + delta[2] * u + pz * (side+Math.sin(u*Math.PI)*(variant?.bend??0)),
    ];
    const h = point(head),
      span = head - tail;
    if (p.form === "blade" && element === "wind") {
      // A single broad, bowed cutting edge with two offset wakes, rather than a fan of rays.
      for (let k = 0; k < 3; k++) {
        const back = k * 0.28,
          s = 2.25 - k * 0.1;
        this.bodies.curve(
          [
            h[0] - px * s - dx * (0.9 + back),
            h[1] - 0.05,
            h[2] - pz * s - dz * (0.9 + back),
          ],
          [
            h[0] - px * s * 0.5 - dx * back,
            h[1] + 0.35,
            h[2] - pz * s * 0.5 - dz * back,
          ],
          [
            h[0] + px * s * 0.5 - dx * back,
            h[1] + 0.35,
            h[2] + pz * s * 0.5 - dz * back,
          ],
          [
            h[0] + px * s - dx * (0.9 + back),
            h[1] - 0.05,
            h[2] + pz * s - dz * (0.9 + back),
          ],
          k === 0 ? 0.38 : 0.2,
          k === 0 ? pal.core : k === 1 ? pal.edge : pal.secondary,
          fade * (k === 0 ? 0.8 : 0.42),
          seed + k,
          0.35,
          2,
        );
      }
      return;
    }
    if (p.form === "wing") {
      // The leading wing arch carries the silhouette; staggered trailing feathers open behind it.
      for (const side of [-1, 1])
        for (let k = 0; k < 4; k++) {
          const s = side * (3.85 - k * 0.38),
            back = 1.05 + k * 0.22,
            flap = Math.sin(t * 5 + seed * 0.1) * 0.35;
          this.bodies.curve(
            h,
            [h[0] + px * s * 0.25, h[1] + 1.15 + flap, h[2] + pz * s * 0.25],
            [
              h[0] + px * s * 0.78 - dx * 0.3,
              h[1] + 0.9 + flap - k * 0.16,
              h[2] + pz * s * 0.78 - dz * 0.3,
            ],
            [
              h[0] + px * s - dx * back,
              h[1] + 0.14 - k * 0.18,
              h[2] + pz * s - dz * back,
            ],
            k === 0 ? 0.3 : 0.21,
            k === 0 ? pal.core : k % 2 ? pal.edge : pal.secondary,
            fade * (0.78 - k * 0.09),
            seed + k,
            0.35,
            1,
          );
        }
      this.bodies.curve(
        point(Math.max(0, head - 0.25)),
        point(head - 0.15, 0, 0.25),
        point(head - 0.04, 0, 0.3),
        h,
        0.42,
        pal.edge,
        fade * 0.8,
        seed,
        0.7,
        1,
      );
      return;
    }
    const meteor = p.form === "meteor",
      whip = p.form === "blade";
    const width = meteor
      ? Math.min(0.85, p.radius * 0.16)
      : whip
        ? 0.17
        : p.status === "freeze"
          ? 0.095
          : p.form === "beam"
            ? 0.13
            : 0.1;
    for (let k = 0; k < 3; k++) {
      const side = (k - 1) * (meteor ? 0.38 : whip ? 0.22 : 0.11),
        sway = Math.sin(t * 5 + seed * 0.9) * (whip ? 1.7 : 0.16),
        warm = element === "fire";
      const a = point(tail, side * 0.4),
        b = point(
          tail + span * 0.34,
          side + sway,
          whip ? 1.1 : meteor ? 0.25 : 0.09,
        ),
        c = point(tail + span * 0.75, side - sway * 0.4, whip ? 0.35 : 0.09);
      this.bodies.curve(
        a,
        b,
        c,
        h,
        width * (k === 1 ? 1 : 0.52) * (element === "earth" ? 1 : element === "water" ? 2.3*(variant?.width??1) : 1.9),
        k === 1 ? pal.core : k === 0 ? pal.edge : pal.secondary,
        fade * (k === 1 ? 0.73 : 0.57),
        seed + k,
        k === 1 ? 0.8 : 0.45,
        warm ? 1 : 0,
      );
    }
    if (element === "water" && p.form === "beam") {
      this.bodies.curve(
        point(tail),
        point(tail + span * 0.3, 0.1, 0.18),
        point(tail + span * 0.7, -0.13, -0.08),
        h,
        0.34,
        pal.edge,
        fade * 0.68,
        seed,
        0.8,
        0,
      );
    }
  }
  field(
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    time: number,
    alpha: number,
    seed: number,
    kind: "flame" | "jet" | "vortex" | "whirlpool",
  ): void {
    const pal = this.palette;
    if (kind === "vortex" || kind === "whirlpool") {
      const flat = kind === "whirlpool",
        count = flat ? 3 : 4;
      for (let k = 0; k < count; k++)
        for (let part = 0; part < 3; part++) {
          const begin = part / 3,
            end = (part + 1) / 3;
          const sample = (u: number): Vec3 => {
            const a =
              (k * TAU) / count +
              u * (flat ? 4.6 : 5.8) +
              time * (flat ? -2.9 : 2.6);
            const r =
              radius *
              (flat ? 1 - u * 0.9 : 0.15 + u * 0.85) *
              (1 + 0.045 * Math.sin(u * 12 - time * 9));
            return [
              x + Math.cos(a) * r,
              y + 0.12 + (flat ? Math.sin(u * Math.PI) * 0.45 : u * height),
              z + Math.sin(a) * r,
            ];
          };
          const a = sample(begin),
            d = sample(end),
            epsilon = 0.002,
            tangentA = sample(begin + epsilon),
            tangentD = sample(end - epsilon),
            du = (end - begin) / 3 / epsilon;
          const b: Vec3 = [
            a[0] + (tangentA[0] - a[0]) * du,
            a[1] + (tangentA[1] - a[1]) * du,
            a[2] + (tangentA[2] - a[2]) * du,
          ];
          const c: Vec3 = [
            d[0] + (tangentD[0] - d[0]) * du,
            d[1] + (tangentD[1] - d[1]) * du,
            d[2] + (tangentD[2] - d[2]) * du,
          ];
          this.bodies.curve(
            a,
            b,
            c,
            d,
            (flat ? 0.32 : 0.38) * (1 + part * 0.25),
            k === 0 ? pal.core : k % 2 ? pal.edge : pal.secondary,
            alpha * (k === 0 ? 0.5 : 0.65),
            seed + k,
            0.35,
            2,
          );
        }
      return;
    }
    const count = kind === "flame" ? 13 : 6;
    for (let k = 0; k < count; k++) {
      const a =
          (kind === "flame" ? k * 2.39996 : (k * TAU) / count) +
          time * (kind === "flame" ? 0.12 : 0.25) +
          seed * 0.31,
        cs = Math.cos(a),
        sn = Math.sin(a),
        curl = Math.sin(time * 4 + k * 1.7) * 0.45;
      if (kind === "flame") {
        const cycle = (time * (1.4 + (k % 3) * .23) + k * .381) % 1,
          flutter = .78 + Math.sin(time * 9.3 + k * 2.7) * .12 + Math.sin(time * 15.1 + k) * .1,
          r = radius * (0.12 + (k % 5) * 0.13),
          h = height * (0.32 + (k % 4) * 0.18) * flutter,
          s = radius * .13,
          drift = Math.sin(time * 2.6 + k * 1.9) * radius * .25;
        this.bodies.curve(
          [x + cs * r, y + 0.05, z + sn * r],
          [
            x + cs * (r + s) - sn * curl,
            y + h * 0.3,
            z + sn * (r + s) + cs * curl,
          ],
          [
            x + cs * r * .65 + sn * curl + drift,
            y + h * 0.73,
            z + sn * r * .65 - cs * curl,
          ],
          [
            x + cs * r * .5 + sn * curl * .7 + drift,
            y + h,
            z + sn * r * .5 - cs * curl * .7,
          ],
          Math.min(1.25, 0.22 + radius * 0.3) * (0.7 + Math.sin(cycle * Math.PI) * .35),
          k === 0 ? pal.core : k % 3 ? pal.edge : pal.secondary,
          alpha * (k === 0 ? 0.58 : k % 3 ? 0.8 : 0.55),
          seed + k,
          0.8,
          1,
        );
      } else {
        const reach = radius * (0.55 + (k % 4) * 0.16),
          h = height * (0.6 + (k % 3) * 0.15),
          startHeight = h * (0.24 + (k % 2) * 0.18),
          fall = 0.58 + Math.sin(time * 5 + k * 1.7) * 0.16;
        this.bodies.curve(
          [x + cs * 0.1, y + startHeight, z + sn * 0.1],
          [x + cs * 0.2, y + h * 1.15, z + sn * 0.2],
          [x + cs * reach * 0.7, y + h * 1.05, z + sn * reach * 0.7],
          [x + cs * reach, y + h * fall, z + sn * reach],
          0.19 + radius * 0.09,
          k === 0 ? pal.core : k % 2 ? pal.edge : pal.secondary,
          alpha * 0.54,
          seed + k,
          0.65,
          0,
        );
      }
    }
  }
  impact(
    p: ElementalPulse,
    t: number,
    element: SpellElement,
    seed: number,
  ): void {
    const pal = this.palette,
      [x, , z] = p.point,
      y = this.ground(x, z),
      r = p.radius;
    if (t < 0 || t > 0.82) return;
    const fade = 1 - ease((t - 0.14) / 0.65),
      expand = 1 - Math.exp(-t * 10);
    // Contraction pulses draw inward, instead of reusing the outward explosion silhouette.
    if (p.form === "vortex") return;
    if (r > 1.5 && p.form !== "wave")
      this.shockFront(x, y, z, r, t, fade, element, seed);
    if (element === "fire" && r < 1.5) {
      this.field(x, y, z, 0.35, 0.9, t, fade, seed, "flame");
      return;
    }
    if (element === "fire") return; // Flame bodies own this silhouette.
    const count = element === "earth" ? 5 : element === "water" ? 7 : 3;
    for (let k = 0; k < count; k++) {
      const angle = (k * TAU) / count + seed * 0.71,
        cs = Math.cos(angle),
        sn = Math.sin(angle);
      const distance = r * (element === "earth" ? 1.05 : 0.85) * expand;
      const lift =
        element === "earth"
          ? 0.22
          : element === "water"
            ? (0.5 + Math.sqrt(r) * 0.55) * Math.sin(clamp(t / 0.8) * Math.PI)
            : 0.18;
      const h = element === "wind" && r < 1.5 ? 1.25 : 0;
      this.bodies.curve(
        [x, y + 0.1 + h, z],
        [
          x + cs * distance * 0.25 - sn * 0.2,
          y + lift + h,
          z + sn * distance * 0.25 + cs * 0.2,
        ],
        [
          x + cs * distance * 0.78 - sn * 0.4,
          y + lift * 0.75 + h,
          z + sn * distance * 0.78 + cs * 0.4,
        ],
        [x + cs * distance, y + 0.07 + h, z + sn * distance],
        element === "earth" ? 0.07 : element === "water" ? 0.2 : 0.19,
        k === 0 ? pal.core : k % 2 ? pal.edge : pal.secondary,
        fade * 0.68,
        seed + k,
        0.4,
        element === "wind" ? 2 : 0,
      );
    }
  }
  private shockFront(
    x: number,
    y: number,
    z: number,
    radius: number,
    t: number,
    fade: number,
    element: SpellElement,
    seed: number,
  ): void {
    const pal = this.palette,
      r = radius * (0.2 + 1.05 * (1 - Math.exp(-t * 7))),
      count = element === "wind" ? 4 : 6;
    for (let k = 0; k < count; k++) {
      const start = (k * TAU) / count + seed * 0.38,
        end = start + (TAU / count) * 0.91;
      const sample = (u: number): Vec3 => {
        const a = start + (end - start) * u,
          rad = r * (1 + 0.035 * Math.sin(a * 5 + seed));
        return [
          x + Math.cos(a) * rad,
          y +
            0.1 +
            Math.sin(u * Math.PI) *
              (element === "earth" ? 0.12 : 0.28) *
              (1 - t),
          z + Math.sin(a) * rad,
        ];
      };
      const a = sample(0),
        d = sample(1),
        v0 = sample(0.005),
        v1 = sample(0.995),
        factor = 1 / 0.015;
      const b: Vec3 = [
        a[0] + (v0[0] - a[0]) * factor,
        a[1] + (v0[1] - a[1]) * factor,
        a[2] + (v0[2] - a[2]) * factor,
      ];
      const c: Vec3 = [
        d[0] + (v1[0] - d[0]) * factor,
        d[1] + (v1[1] - d[1]) * factor,
        d[2] + (v1[2] - d[2]) * factor,
      ];
      this.bodies.curve(
        a,
        b,
        c,
        d,
        0.08 + Math.sqrt(radius) * 0.055,
        k % 3 ? pal.edge : pal.secondary,
        fade * 0.65,
        seed + k,
        0.75,
        element === "fire" ? 1 : 2,
      );
    }
  }
  wave(
    x: number,
    y: number,
    z: number,
    height: number,
    forward: number,
    d: readonly [number, number],
    t: number,
    fade: number,
    seed: number,
  ): void {
    const pal = this.palette;
    for (let k = 0; k < 3; k++) {
      const p = (side: number, lift: number): Vec3 => [
        x + d[1] * side + d[0] * (forward + 0.55 + k * 0.09),
        y + height * fade * lift + 0.04,
        z - d[0] * side + d[1] * (forward + 0.55 + k * 0.09),
      ];
      this.bodies.curve(
        p(-1.85, 0.82),
        p(-0.65, 1.06 + Math.sin(t * 5 + seed) * 0.025),
        p(0.65, 1.06),
        p(1.85, 0.82),
        k === 0 ? 0.15 : 0.1,
        k === 0 ? pal.core : k === 1 ? pal.secondary : pal.edge,
        fade * 0.55,
        seed + k,
        0.5,
        0,
      );
    }
  }
}
