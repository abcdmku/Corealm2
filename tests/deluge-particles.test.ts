import { createHash } from "node:crypto";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FINALE } from "../game/src/content/elementalFinales.js";
import { DelugeParticles } from "../game/src/render/delugeParticles.js";
import { delugeSplashPoint } from "../game/src/render/delugeSurface.js";
import { lowerToWgsl } from "./helpers/wgsl.js";

const crash = FINALE.deluge.contact + FINALE.deluge.rowGap * 2;
const random = (i: number, s: number) => { const n = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return n - Math.floor(n); };
const ease = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
function digest(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): string {
  const array = attribute.array;
  return createHash("sha256").update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest("hex");
}

describe("Deluge GPU particle recipes", () => {
  it("preserves the authored Float32 launch, color and shape data", () => {
    const particles = new DelugeParticles(new THREE.Group());
    try {
      const launch = particles.spray.geometry.getAttribute("delugeLaunch"), motion = particles.spray.geometry.getAttribute("delugeMotion");
      const tint = particles.spray.geometry.getAttribute("delugeTint"), shape = particles.spray.geometry.getAttribute("delugeShape");
      for (const i of [0, 43, 5999, 6000, 17999]) {
        const burst = i < 6000, birth = .018 + random(i, 30) ** 1.7 * (burst ? .115 : .26), v = random(i, 32);
        const point = delugeSplashPoint(Math.floor(random(i, 31) * 8), random(i, 36), burst ? .18 + v * .45 : .52 + v * .46, crash + birth * 1000);
        const angle = Math.atan2(point[2], point[0]) - (burst ? .25 : .7) + (random(i, 37) - .5) * .85;
        const speed = burst ? 6 + random(i, 33) * 9 : 1.2 + random(i, 33) * 5.8;
        expect([launch.getX(i), launch.getY(i), launch.getZ(i), launch.getW(i)])
          .toEqual(Array.from(new Float32Array([birth, ...point])));
        expect([motion.getX(i), motion.getY(i), motion.getZ(i), motion.getW(i)])
          .toEqual(Array.from(new Float32Array([Math.cos(angle) * speed, burst ? 2 + random(i, 34) * 5 : 3.5 + random(i, 34) * 8.5, Math.sin(angle) * speed,
            i % 43 === 0 ? .060 + v * .032 : .018 + random(i, 35) * .028])));
        const color = new THREE.Color(i % 7 ? 0x8cb9c1 : 0xd6e8e8);
        expect([tint.getX(i), tint.getY(i), tint.getZ(i)]).toEqual(Array.from(new Float32Array(color.toArray())));
        expect([shape.getX(i), shape.getY(i), shape.getZ(i), shape.getW(i)])
          .toEqual(Array.from(new Float32Array([i * .71, .55 + Math.abs(Math.sin(i * 3)) * .6, 1.25, i])));
      }
      const foam = particles.foam.geometry.getAttribute("delugeFoam");
      for (const i of [0, 17, 11999]) expect([foam.getX(i), foam.getY(i), foam.getZ(i), foam.getW(i)])
        .toEqual(Array.from(new Float32Array([random(i, 10) * Math.PI * 2, .26 + random(i, 11) * .65, random(i, 16), .017 + random(i, 12) * .025])));
    } finally { particles.dispose(); }
  });

  it("counts actual live particles across births, landings, fading and time seeks", () => {
    const particles = new DelugeParticles(new THREE.Group());
    try {
      const launch = particles.spray.geometry.getAttribute("delugeLaunch"), motion = particles.spray.geometry.getAttribute("delugeMotion"), foam = particles.foam.geometry.getAttribute("delugeFoam");
      const ages = [-1, 0, 350, 400, 600, 1500, 3250, 3300, 3310, 3330, 3400, 3450, 3510, 3530, 3600, 4000, 4500, 5300, 6000, 6550, 6699, 6700, 3400, 400];
      for (const i of [0, 97, 6000, 17999]) {
        const birth = launch.getX(i), vy = motion.getY(i), h = launch.getZ(i);
        const death = birth + (vy + Math.sqrt(vy * vy + 24 * h)) / 12;
        ages.push(crash + birth * 1000 - .001, crash + birth * 1000 + .001, crash + death * 1000 - .001, crash + death * 1000 + .001);
      }
      for (const age of ages) {
        particles.begin(age / 1000);
        expect(particles.instances).toBe(0); expect(particles.candidateCount).toBe(0);
        particles.update(4, 7, -3, age); particles.end();
        let expected = 0;
        if (age >= 0 && age < FINALE.deluge.end) {
          const a = (age - crash) / 1000, rise = ease((age - 300) / 1250), vanish = 1 - ease(a / .24), rain = 1 - ease((a - 2.3) / 1.1);
          if (rise > .01 && vanish > .01) for (let i = 0; i < 12000; i++) {
            const spill = (foam.getZ(i) + age / 1000 * .85) % 1;
            if (rise * vanish * (.6 + spill * .3) >= .006) expected++;
          }
          if (a >= 0 && rain * .94 >= .006) for (let i = 0; i < 18000; i++) {
            const flight = a - launch.getX(i), h = launch.getZ(i) + motion.getY(i) * flight - 6 * flight * flight;
            if (flight >= 0 && h >= 0) expected++;
          }
        }
        expect(particles.instances, `age ${age}`).toBe(expected);
        expect(particles.candidateCount).toBeGreaterThanOrEqual(expected);
        expect(particles.candidateCount).toBeLessThanOrEqual(30000);
        expect(particles.dropped).toBe(0);
      }
    } finally { particles.dispose(); }
  });

  it("shares recipes while uniforms stay private and static GPU attributes never change", () => {
    const first = new DelugeParticles(new THREE.Group()), second = new DelugeParticles(new THREE.Group());
    try {
      expect(first.spray.material).toBe(second.spray.material); expect(first.foam.material).toBe(second.foam.material);
      expect(first.spray.material).not.toBe(first.foam.material);
      for (const key of ["spray", "foam"] as const) {
        expect(first[key].geometry).not.toBe(second[key].geometry);
        for (const name of Object.keys(first[key].geometry.attributes).filter(name => name.startsWith("deluge"))) {
          const a = first[key].geometry.getAttribute(name), b = second[key].geometry.getAttribute(name);
          expect(a).not.toBe(b); expect(a.array.buffer).not.toBe(b.array.buffer);
          expect(digest(a)).toBe(digest(b));
        }
      }
      expect(first.spray.userData["effectClock"]).not.toBe(second.spray.userData["effectClock"]);
      expect(first.foam.userData["delugeParticles"]).not.toBe(second.foam.userData["delugeParticles"]);
      const attributes = [first.foam, first.spray].flatMap(mesh => Object.values(mesh.geometry.attributes));
      const before = attributes.map(attribute => ({ hash: digest(attribute), version: (attribute as THREE.BufferAttribute).version }));
      for (let i = 0; i < 90; i++) { first.begin(i / 60); first.update(10, 3, -12, i * 75); first.end(); }
      second.begin(90); second.update(-4, 2, 8, 1500); second.end();
      expect(first.spray.userData["effectClock"].value).toBe(89 / 60);
      expect(second.spray.userData["effectClock"].value).toBe(90);
      expect(first.spray.userData["delugeParticles"].origin.toArray()).toEqual([10, 3, -12]);
      expect(second.spray.userData["delugeParticles"].origin.toArray()).toEqual([-4, 2, 8]);
      expect(attributes.map(attribute => ({ hash: digest(attribute), version: (attribute as THREE.BufferAttribute).version }))).toEqual(before);
    } finally { first.dispose(); second.dispose(); }
  });

  it("keeps the lowered foam curl tied to the original seed angle", () => {
    const particles = new DelugeParticles(new THREE.Group());
    try {
      const vertex = lowerToWgsl(particles.foam).vertex;
      const assignments = [...vertex.matchAll(/^\s*(\w+)\s*=\s*(.+);$/gm)].map(match => [match[1]!, match[2]!] as const);
      // Locate the authored curl by its flutter amplitude and quarter-turn offset,
      // not Three's generated temporary IDs. This curl drives both height and radius.
      const curl = assignments.find(([, value]) => value.includes("0.23") && value.includes("1.570796"));
      expect(curl).toBeDefined();
      const angle = curl![1].match(/sin\s*\(\s*\(\s*\(\s*([\w.]+)\s*\*\s*3\.0\s*\)/)?.[1];
      expect(angle).toBeDefined();
      if (angle !== "delugeFoam.x") {
        // An immutable compiler alias is fine. An angle assigned again before the
        // lazy curl expression is lowered reproduces the moving-lip regression.
        const definitions = assignments.filter(([name]) => name === angle);
        expect(definitions).toHaveLength(1);
        expect(definitions[0]![1].replace(/[()\s]/g, "")).toBe("delugeFoam.x");
      }
      for (const operation of ["sin", "cos"]) {
        const use = new RegExp(`\\b${operation}\\s*\\(\\s*${curl![0]}\\s*\\)`);
        expect(assignments.some(([, value]) => use.test(value))).toBe(true);
      }
    } finally { particles.dispose(); }
  });

  it("lowers both complete deformation and lifetime recipes to WGSL", () => {
    const particles = new DelugeParticles(new THREE.Group());
    try {
      for (const mesh of [particles.foam, particles.spray]) {
        const shader = lowerToWgsl(mesh);
        expect(shader.vertex).toContain("delugeShape"); expect(shader.vertex).toContain("delugeTint");
        expect(shader.fragment).toContain("discard"); expect(shader.fragment).toContain("32.0");
        expect(shader.vertex).not.toContain("centreSize");
      }
      const foam = lowerToWgsl(particles.foam).vertex, spray = lowerToWgsl(particles.spray).vertex;
      expect(foam).toContain("delugeFoam"); expect(foam).toContain("1.35"); expect(foam).toContain("1650.0");
      expect(spray).toContain("delugeLaunch"); expect(spray).toContain("delugeMotion");
      expect(spray).toContain("12.0"); expect(spray).toContain("6.0"); expect(spray).toContain("0.45");
    } finally { particles.dispose(); }
  });
});
