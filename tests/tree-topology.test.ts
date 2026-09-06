import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { transformSync } from "esbuild";
import { Color } from "three";

type V = [number, number, number];
interface Axis {
  id: number; parent: number | null; attachment: number; attachmentFraction: number;
  order: number; rings: { p: V; radius: number }[]; leafBearing: boolean;
}
interface Tree {
  id: string; kind: "oak" | "pine"; axes: Axis[]; parts: number; triangles: number; laminae: number;
  rootHash: string; boleHash: string; min: V; max: V; target: { min: V; max: V };
  crownCells: number;
  leafAttachmentError: number;
  cardRolls: number[];
}

// The generator is a CLI with live writes at its entry point. Execute its production geometry
// section in isolation; the tests never run its exporter or touch the public asset directory.
function geometryBuilder() {
  const file = path.resolve("tools/build-corealm-nature.ts");
  const source = readFileSync(file, "utf8").split("interface EncodingReference")[0]!.replace(/^import .+;\r?$/gm, "");
  const code = transformSync(source, { loader: "ts", target: "es2022", format: "cjs" }).code;
  const create = new Function("Color", "path", "gameRoot", "repoRoot", "process", "NodeIO", "KHRMeshQuantization", "createHash", `${code}
    const positionHash = (values, start, end, ceiling) => {
      const keys = new Set();
      for (let i = start; i < end; i += 3) if (Math.fround(values[i + 1]) <= ceiling)
        keys.add([Math.fround(values[i]), Math.fround(values[i + 1]), Math.fround(values[i + 2])].join(','));
      return createHash('sha256').update([...keys].sort().join('\\n')).digest('hex');
    };
    return {
      specs: specs.filter(spec => spec.kind === 'oak' || spec.kind === 'pine'),
      joint: treeJoint,
      generate(spec) {
        const plant = new Plant(spec), parts = [], original = plant.branch;
        let leafAttachmentError = 0;
        plant.branch = function(...args) {
          const start = this.skins.bark.positions.length;
          const result = original.apply(this, args);
          parts.push([start, this.skins.bark.positions.length]);
          return result;
        };
        const bases = [], cardRolls = [], originalCard = plant.foliageCard;
        plant.foliageCard = function(base, ...args) {
          bases.push(base);
          cardRolls.push(args[3]);
          return originalCard.call(this, base, ...args);
        };
        const axes = ({oak, pine})[spec.kind](plant);
        for (const base of bases) {
          let nearest = Infinity;
          for (const axis of axes.filter(axis => axis.leafBearing)) {
            for (let segment = 0; segment < axis.rings.length - 1; segment++) {
              const a = axis.rings[segment].p, b = axis.rings[segment + 1].p;
              if (Math.hypot(...sub(base, a)) > Math.hypot(...sub(b, a)) + .5) continue;
              let lo = 0, hi = 1;
              const distance = t => Math.hypot(...sub(base, treeJoint(axis, segment, t).p));
              for (let n = 0; n < 32; n++) {
                const l = lo + (hi-lo)/3, r = hi - (hi-lo)/3;
                if (distance(l) < distance(r)) hi = r; else lo = l;
              }
              nearest = Math.min(nearest, distance((lo+hi)/2), distance(0), distance(1));
            }
          }
          leafAttachmentError = Math.max(leafAttachmentError, nearest);
        }
        fitProductionBounds(plant);
        const triangles = validateGeometry(plant);
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const skin of Object.values(plant.skins)) for (let i = 0; i < skin.positions.length; i++) {
          const a = i % 3; min[a] = Math.min(min[a], skin.positions[i]); max[a] = Math.max(max[a], skin.positions[i]);
        }
        const crown = new Map(), leaf = plant.skins.leaves.positions;
        const low = [min[0], max[1] * .30, min[2]], span = [max[0] - min[0], max[1] * .70, max[2] - min[2]];
        for (let i = 0; i < leaf.length; i += 9) {
          const a = leaf.slice(i, i + 3), b = leaf.slice(i + 3, i + 6), c = leaf.slice(i + 6, i + 9);
          const area = Math.hypot(...cross(sub(b, a), sub(c, a))) * .5;
          // A spray card covers several cells; sample four equal-area subtriangles.
          for (const weights of [[1/3,1/3,1/3],[2/3,1/6,1/6],[1/6,2/3,1/6],[1/6,1/6,2/3]]) {
            const cell = a.map((v, j) => Math.floor((v*weights[0] + b[j]*weights[1] + c[j]*weights[2] - low[j]) / span[j] * 8));
            if (cell.some(v => v < 0 || v >= 8)) continue;
            const key = cell.join(','); crown.set(key, (crown.get(key) || 0) + area/4);
          }
        }
        const bark = plant.skins.bark.positions, bole = parts[spec.kind === 'oak' ? 6 : 5];
        return { id: spec.id, kind: spec.kind, axes, parts: parts.length, triangles,
          laminae: plant.leafSprays.length, min, max, target: productionBounds[spec.id],
          crownCells: [...crown.values()].filter(area => area > .02).length, leafAttachmentError, cardRolls,
          rootHash: positionHash(bark, 0, bark.length, .35), boleHash: positionHash(bark, bole[0], bole[1], 1.8) };
      }
    };`);
  class UnusedIO { registerExtensions() { return this; } }
  return create(Color, path, path.resolve("game"), process.cwd(), process, UnusedIO, class {}, createHash) as {
    specs: { id: string; kind: "oak" | "pine" }[];
    joint: (parent: Axis, segment: number, fraction: number) => { p: V; radius: number };
    generate: (spec: { id: string; kind: "oak" | "pine" }) => Tree;
  };
}

describe("native tree branch topology", () => {
  const builder = geometryBuilder();
  let trees: Tree[];
  beforeAll(() => { trees = builder.specs.map(spec => builder.generate(spec)); }, 20000);

  it("keeps grounded pivots, slender trunks and stable placement envelopes", () => {
    for (const tree of trees) {
      expect(tree.min[1], tree.id).toBeCloseTo(0, 8);
      expect(tree.axes[0]!.rings[0]!.radius / tree.max[1], tree.id).toBeLessThan(.06);
      if (tree.target) for (let a=0;a<3;a++) {
        expect(tree.min[a]).toBeCloseTo(tree.target.min[a]!,8);
        expect(tree.max[a]).toBeCloseTo(tree.target.max[a]!,8);
      }
    }
  });

  it("connects the wood scaffold supporting textured branch sprays", () => {
    for (const tree of trees) {
      expect(tree.axes.filter(axis => axis.parent === null), tree.id).toHaveLength(1);
      expect(tree.parts, `${tree.id} every wood sweep accounted for`).toBe(tree.axes.length + (tree.kind === "oak" ? 6 : 5));
      expect(Math.max(...tree.axes.map(axis => axis.order)), tree.id).toBeGreaterThanOrEqual(2);
      expect(tree.axes.filter(axis => axis.order === 2).length, tree.id).toBeGreaterThanOrEqual(3);
      for (const axis of tree.axes) {
        if (axis.parent === null) continue;
        expect(axis.parent, tree.id).toBeLessThan(axis.id);
        const parent = tree.axes[axis.parent]!;
        expect(axis.order, tree.id).toBe(parent.order + 1);
        expect(axis.attachment, tree.id).toBeGreaterThanOrEqual(0);
        expect(axis.attachment, tree.id).toBeLessThan(parent.rings.length);
        expect(axis.attachmentFraction, tree.id).toBeGreaterThanOrEqual(0);
        expect(axis.attachmentFraction, tree.id).toBeLessThan(1);
        const joint = builder.joint(parent, axis.attachment, axis.attachmentFraction);
        expect(Math.hypot(...axis.rings[0]!.p.map((v, i) => v - joint.p[i]!)), `${tree.id} axis ${axis.id} seated collar`).toBeLessThan(1e-9);
        expect(axis.rings[0]!.radius, `${tree.id} child diameter`).toBeLessThanOrEqual(joint.radius + 1e-12);
      }
    }
  });

  it("tapers wood toward the tips and ends in fine shoots", () => {
    for (const tree of trees) for (const axis of tree.axes) {
      for (let i = 1; i < axis.rings.length; i++) {
        expect(axis.rings[i]!.radius, `${tree.id} axis ${axis.id} ring ${i}`).toBeLessThanOrEqual(axis.rings[i - 1]!.radius);
      }
      if (axis.parent !== null && axis.rings[0]!.radius > 0.01) {
        expect(axis.rings.at(-1)!.radius / axis.rings[0]!.radius, `${tree.id} branch tip`).toBeLessThan(0.5);
      }
    }
  });

  it("seats every textured spray on its curved wood branch", () => {
    // Linear interpolation through the authored control polygon floated lamina bases away
    // from the Hermite centreline used by the real swept bark geometry.
    for (const tree of trees) expect(tree.leafAttachmentError, tree.id).toBeLessThan(1e-5);
  });

  it("keeps distinct age scaffolds and detailed crowns within the native geometry budgets", () => {
    for (const kind of ["oak", "pine"] as const) {
      const variants = trees.filter(tree => tree.kind === kind);
      const scaffolds = variants.map(tree => tree.axes.filter(axis => axis.order === 1)
        .map(axis => [axis.attachment, axis.attachmentFraction, ...axis.rings.at(-1)!.p]));
      expect(new Set(scaffolds.map(value => JSON.stringify(value))).size, kind).toBe(variants.length);
      expect(new Set(variants.map(tree => tree.axes.filter(axis => axis.order === 1).length)).size, `${kind} age structure`).toBeGreaterThan(1);
    }
    for (const tree of trees) {
      expect(tree.triangles, tree.id).toBeLessThanOrEqual(tree.kind === "oak" ? 18000 : 22000);
      expect(tree.laminae, tree.id).toBeGreaterThanOrEqual(40);
      expect(tree.laminae, tree.id).toBeLessThan(900);
      expect(tree.axes.filter(axis => axis.leafBearing && axis.order === 2).length, tree.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps broadleaf clusters facing upward instead of randomly rolling their planes", () => {
    for (const tree of trees.filter(tree => tree.kind === "oak")) {
      expect(tree.cardRolls.length).toBe(tree.laminae);
      expect(Math.max(...tree.cardRolls.map(Math.abs)), tree.id).toBeLessThan(Math.PI / 4);
    }
  });

  it("distributes foliage through the crown instead of only along a few narrow branch tips", () => {
    for (const tree of trees) {
      // Count occupied cells in an 8³ crown grid above 30% of tree height, with at least .02 m²
      // of real lamina in each cell. Leaf count alone missed the rejected sparse-arm canopy.
      // This is a spatial regression guard; production screenshots still decide visual acceptance.
      expect(tree.crownCells, tree.id).toBeGreaterThanOrEqual(tree.kind === "oak" ? 160 : 120);
    }
  });
});
