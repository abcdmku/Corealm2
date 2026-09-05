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
        plant.branch = function(...args) {
          const start = this.skins.bark.positions.length;
          const result = original.apply(this, args);
          parts.push([start, this.skins.bark.positions.length]);
          return result;
        };
        const axes = ({oak, pine})[spec.kind](plant);
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
          const cell = a.map((v, j) => Math.floor(((v + b[j] + c[j]) / 3 - low[j]) / span[j] * 8));
          if (cell.some(v => v < 0 || v >= 8)) continue;
          const key = cell.join(','); crown.set(key, (crown.get(key) || 0) + area);
        }
        const bark = plant.skins.bark.positions, bole = parts[spec.kind === 'oak' ? 6 : 5];
        return { id: spec.id, kind: spec.kind, axes, parts: parts.length, triangles,
          laminae: plant.leafSprays.length, min, max, target: productionBounds[spec.id],
          crownCells: [...crown.values()].filter(area => area > .02).length,
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

// Float32 position sets measured from the original six production GLBs. Root sets contain all
// bark below .35 m; bole sets contain the connected central trunk below 1.8 m, excluding roots.
const baseline: Record<string, readonly [string, string]> = {
  corealm_oak_1: ["7ebf4ea49515c941ca25bc6f9c7e345fc4b5bfb5f26d627720798e512e0839a2", "7b57d326bf0292301adc50619a28768a22d10f176553b9c25e94ac395e0b3f41"],
  corealm_oak_2: ["110a455ff81074eea7f082fd9a9546593f5581f807afedef0bca3b1b86057920", "0529bc87318c0db2630ada819eb57f41b88fc447e3fd3b64d53ecafd808f354f"],
  corealm_oak_3: ["cd6ec704803a6ccb9de574184ede639f43a04fa635b927f58bc8eb658e7ce355", "f15f7e111820fab905dfcaee27562ac3332f3da608a7fe7672f91d36317b4558"],
  corealm_pine_1: ["715712588371efebba5a34532fd025c56ad0250b26f9be7d3c59916afa336529", "cbc4ec32194d80baca071015e068b7c30821a4cd167625068f223f3abf7cdb5c"],
  corealm_pine_2: ["7593c6cb9bfba852092bee5519431d3a3e86f7ce963b389f5769b2a47f6fe02d", "2588a55a79292ca8f66fc3db30f57383cb593f95aa7268797d84a486734d2354"],
  corealm_pine_3: ["11915f3a4da8220a9071e7511f90317a0abf144ef04b5a2ee12408e2decf4eb5", "f1acf22a5e3659a2bdc5abbcf5d6e30920db3761a9396bafb132109d45a0f8ba"],
};

describe("native tree branch topology", () => {
  const builder = geometryBuilder();
  let trees: Tree[];
  beforeAll(() => { trees = builder.specs.map(spec => builder.generate(spec)); }, 20000);

  it("preserves the complete production envelope and exact roots and lower trunks", () => {
    for (const tree of trees) {
      expect(tree.rootHash, `${tree.id} ground contact`).toBe(baseline[tree.id]![0]);
      expect(tree.boleHash, `${tree.id} trunk collision silhouette`).toBe(baseline[tree.id]![1]);
      for (let a = 0; a < 3; a++) {
        expect(tree.min[a], `${tree.id} minimum axis ${a}`).toBeCloseTo(tree.target.min[a]!, 10);
        expect(tree.max[a], `${tree.id} maximum axis ${a}`).toBeCloseTo(tree.target.max[a]!, 10);
      }
    }
  });

  it("emits a complete parented wood hierarchy through tertiary branches and leaf shoots", () => {
    for (const tree of trees) {
      expect(tree.axes.filter(axis => axis.parent === null), tree.id).toHaveLength(1);
      expect(tree.parts, `${tree.id} every wood sweep accounted for`).toBe(tree.axes.length + (tree.kind === "oak" ? 6 : 5));
      expect(Math.max(...tree.axes.map(axis => axis.order)), tree.id).toBeGreaterThanOrEqual(tree.kind === "oak" ? 5 : 4);
      expect(tree.axes.filter(axis => axis.order === 2).length, tree.id).toBeGreaterThanOrEqual(12);
      expect(tree.axes.filter(axis => axis.order === 3).length, tree.id).toBeGreaterThanOrEqual(24);
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

  it("tapers wood toward the tips and retains collar volume at visible forks", () => {
    for (const tree of trees) for (const axis of tree.axes) {
      for (let i = 1; i < axis.rings.length; i++) {
        expect(axis.rings[i]!.radius, `${tree.id} axis ${axis.id} ring ${i}`).toBeLessThanOrEqual(axis.rings[i - 1]!.radius);
      }
      if (axis.parent !== null && axis.rings[0]!.radius > 0.01) {
        expect(axis.rings[0]!.radius / axis.rings[1]!.radius, `${tree.id} branch collar`).toBeGreaterThan(1.1);
        expect(axis.rings.at(-1)!.radius / axis.rings[0]!.radius, `${tree.id} branch tip`).toBeLessThan(0.12);
      }
    }
  });

  it("keeps distinct age scaffolds and detailed crowns within the native geometry budgets", () => {
    for (const kind of ["oak", "pine"] as const) {
      const variants = trees.filter(tree => tree.kind === kind);
      const scaffolds = variants.map(tree => tree.axes.filter(axis => axis.order === 1)
        .map(axis => [axis.attachment, axis.attachmentFraction, ...axis.rings.at(-1)!.p]));
      expect(new Set(scaffolds.map(value => JSON.stringify(value))).size, kind).toBe(3);
      expect(new Set(variants.map(tree => tree.axes.filter(axis => axis.order === 1).length)).size, `${kind} age structure`).toBeGreaterThan(1);
    }
    for (const tree of trees) {
      expect(tree.triangles, tree.id).toBeLessThanOrEqual(tree.kind === "oak" ? 155000 : 140000);
      expect(tree.laminae, tree.id).toBeGreaterThanOrEqual(tree.kind === "oak" ? 3000 : 7500);
      expect(tree.axes.filter(axis => axis.leafBearing && axis.order >= 3).length, tree.id).toBeGreaterThan(100);
    }
  });

  it("distributes foliage through the crown instead of only along a few narrow branch tips", () => {
    for (const tree of trees) {
      // Count occupied cells in an 8³ crown grid above 30% of tree height, with at least .02 m²
      // of real lamina in each cell. Leaf count alone missed the rejected sparse-arm canopy.
      // This is a spatial regression guard; production screenshots still decide visual acceptance.
      expect(tree.crownCells, tree.id).toBeGreaterThanOrEqual(tree.kind === "oak" ? 200 : 180);
    }
  });
});
