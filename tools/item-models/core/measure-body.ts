import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { Matrix4, Vector3 } from "three";
import type { ArmorBodyProfile, FitSection } from "./contracts.js";

type Point = [number, number];
type Segment = [Point, Point];
const source = "game/public/assets/models/character/base_male.glb";
const sourceFile = fileURLToPath(new URL("../../../" + source, import.meta.url));
const bytes = await readFile(sourceFile);
const document = await new NodeIO().readBinary(new Uint8Array(bytes));
const bodyNode = document.getRoot().listNodes().find(node => node.getMesh()?.listPrimitives().some(p => p.getMaterial()?.getName() === "MI_Superhero_Male"));
if (!bodyNode) throw new Error("Native male anatomy primitive MI_Superhero_Male is missing");
const primitive = bodyNode.getMesh()!.listPrimitives().find(p => p.getMaterial()?.getName() === "MI_Superhero_Male")!;
const positions = primitive.getAttribute("POSITION")!, indices = primitive.getIndices();
const matrix = new Matrix4().fromArray(bodyNode.getWorldMatrix());
if (matrix.elements.some((value, i) => Math.abs(value - new Matrix4().elements[i]!) > 1e-6)) {
  throw new Error("Native anatomy mesh bind transform changed; validate skin bind-space before measuring");
}
const points: number[][] = [];
for (let i = 0; i < positions.getCount(); i++) {
  const point: number[] = []; positions.getElement(i, point);
  const world = new Vector3().fromArray(point).applyMatrix4(matrix).toArray();
  if (!world.every(Number.isFinite)) throw new Error("Nonfinite native anatomy vertex");
  points.push(world);
}
const triangles: number[][] = [];
for (let i = 0; i < (indices?.getCount() ?? positions.getCount()); i += 3) {
  triangles.push([0, 1, 2].map(offset => indices ? indices.getScalar(i + offset) : i + offset));
}
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const midpoint = (segment: Segment): Point => [(segment[0][0] + segment[1][0]) / 2, (segment[0][1] + segment[1][1]) / 2];
const warnings: unknown[] = [];

/** Exact triangle-plane intersections, welded only to recover disconnected anatomical loops. */
function contours(axis: 0 | 1, level: number): Segment[][] {
  const perpendicular = axis === 1 ? [0, 2] as const : [1, 2] as const;
  const segments: Segment[] = [];
  for (const triangle of triangles) {
    const hits: Point[] = [];
    for (let edge = 0; edge < 3; edge++) {
      const a = points[triangle[edge]!]!, b = points[triangle[(edge + 1) % 3]!]!;
      const da = a[axis]! - level, db = b[axis]! - level;
      if ((da <= 0 && db > 0) || (db <= 0 && da > 0)) {
        const t = da / (da - db);
        hits.push(perpendicular.map(component => a[component]! + t * (b[component]! - a[component]!)) as Point);
      }
    }
    if (hits.length === 2 && Math.hypot(...subtract(hits[0]!, hits[1]!)) > 1e-9) segments.push([hits[0]!, hits[1]!]);
  }
  const key = (p: Point) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
  const edges = new Map<string, number[]>();
  segments.forEach((segment, index) => segment.forEach(point => { const k = key(point); edges.set(k, [...(edges.get(k) ?? []), index]); }));
  const seen = new Set<number>(), loops: Segment[][] = [];
  for (let start = 0; start < segments.length; start++) {
    if (seen.has(start)) continue;
    const pending = [start], component: Segment[] = [];
    while (pending.length) {
      const index = pending.pop()!; if (seen.has(index)) continue;
      seen.add(index); const segment = segments[index]!; component.push(segment);
      segment.forEach(point => pending.push(...(edges.get(key(point)) ?? [])));
    }
    if (component.length >= 3) {
      const endpoints = new Set(component.flat().map(key));
      const openEndpoints = [...endpoints].filter(endpoint => (edges.get(endpoint)?.length ?? 0) % 2 !== 0).length;
      if (openEndpoints) warnings.push({ axis, level, nativeOpenEndpoints: openEndpoints });
      loops.push(component);
    }
  }
  return loops;
}

type Region = keyof Omit<ArmorBodyProfile, "source" | "sourceSha256">;
function measure(region: Region, level: number): FitSection | null {
  const axis = region === "leftArm" || region === "leftHand" ? 0 : 1;
  let loops = contours(axis, level);
  if (!loops.length) return null;
  const anchor: Point = axis === 0 ? [1.4555, -.0654] : region === "leftLeg" || region === "leftFoot" ? [.1143, -.036] : [0, -.017];
  if (region === "leftLeg" || region === "leftFoot") loops = loops.filter(loop => loop.some(segment => midpoint(segment)[0] > .025));
  const score = (loop: Segment[]) => {
    const pts = loop.flat(), min = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1]))];
    const max = [Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
    const dx = Math.max(min[0]! - anchor[0], anchor[0] - max[0]!, 0), dz = Math.max(min[1]! - anchor[1], anchor[1] - max[1]!, 0);
    return dx * dx + dz * dz - loop.length * 1e-9;
  };
  loops.sort((a, b) => score(a) - score(b));
  if (!loops.length) return null;
  // Distal fingers separate into several closed loops. The glove envelope samples the outermost
  // actual intersection across all digits, while individual finger articulation needs digit data.
  let segments = region === "leftHand" ? loops.flat() : loops[0]!;
  // Shoulder planes join torso and arms. Keep measured torso surface, not the distal arm loop.
  if (region === "torso") segments = segments.filter(segment => segment.every(point => Math.abs(point[0]) < .245));
  if (region === "leftArm") segments = segments.filter(segment => segment.every(point => point[0] > 1.29));
  if (region === "leftLeg" || region === "leftFoot") segments = segments.filter(segment => segment.every(point => point[0] > 0));
  if (segments.length < 3) return null;
  const pts = segments.flat();
  const center: Point = [(Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2,
    (Math.min(...pts.map(p => p[1])) + Math.max(...pts.map(p => p[1]))) / 2];
  const outline: Point[] = [];
  let fallbackRays = 0;
  for (let sample = 0; sample < 32; sample++) {
    const angle = sample * Math.PI * 2 / 32, direction: Point = [Math.cos(angle), Math.sin(angle)];
    const hits: { distance: number; point: Point }[] = [];
    for (const segment of segments) {
      const a = subtract(segment[0], center), edge = subtract(segment[1], segment[0]);
      const determinant = cross(direction, edge);
      if (Math.abs(determinant) < 1e-12) continue;
      const distance = cross(a, edge) / determinant, t = cross(a, direction) / determinant;
      if (distance >= 0 && t >= -1e-8 && t <= 1 + 1e-8) hits.push({ distance, point: [center[0] + direction[0] * distance, center[1] + direction[1] * distance] });
    }
    hits.sort((a, b) => b.distance - a.distance);
    if (hits[0]) outline.push(hits[0].point);
    else {
      // At an intentional anatomical cut or a concave contour gap, use a measured endpoint.
      // Never invent an ellipse radius or a point on a synthetic closing chord.
      fallbackRays++;
      const ranked = pts.map(point => ({ point, angle: Math.abs(Math.atan2(cross(direction, subtract(point, center)), direction[0] * (point[0] - center[0]) + direction[1] * (point[1] - center[1]))) }));
      ranked.sort((a, b) => a.angle - b.angle);
      outline.push([...ranked[0]!.point]);
    }
  }
  outline.sort((a, b) => {
    const angle = (point: Point) => (Math.atan2(point[1] - center[1], point[0] - center[0]) + Math.PI * 2) % (Math.PI * 2);
    return angle(a) - angle(b);
  });
  if (fallbackRays || (loops.length > 1 && region === "leftHand")) warnings.push({ region, level, fallbackRays, connectedContours: loops.length });
  if (![...center, ...outline.flat()].every(Number.isFinite) || outline.length !== 32) throw new Error(`Invalid ${region} section at ${level}`);
  const area = outline.reduce((sum, point, index) => sum + cross(point, outline[(index + 1) % outline.length]!), 0) / 2;
  if (area <= 1e-8) throw new Error(`Nonpositive or degenerate ${region} outline at ${level}`);
  return { level, center, outline };
}
const profile: ArmorBodyProfile = { source, sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  torso: [], head: [], leftLeg: [], leftArm: [], leftHand: [], leftFoot: [] };
const ranges: [Region, number, number, number][] = [
  ["torso", .9, 1.51, .025], ["head", 1.52, 1.809, .02], ["leftLeg", .10, .98, .025],
  ["leftArm", .19, .72, .02], ["leftHand", .70, .84, .01], ["leftFoot", 0, .18, .01],
];
for (const [region, from, to, step] of ranges) {
  const levels = Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => Number((from + i * step).toFixed(6)));
  if (levels.at(-1)! < to - 1e-6) levels.push(to);
  const sections = levels.map(level => measure(region, level)).filter((section): section is FitSection => section !== null);
  if (sections.length < 5) throw new Error(`Insufficient actual contours for ${region}`);
  (profile[region] as FitSection[]).push(...sections);
}
await writeFile(new URL("./body-profile.json", import.meta.url), JSON.stringify(profile, null, 2) + "\n");
console.log(JSON.stringify({ source, sourceSha256: profile.sourceSha256, sections: Object.fromEntries(ranges.map(([region]) => [region, profile[region].length])),
  limits: ["Actual head top is 1.8100767m; no native contour exists at 1.84m.", "32 radial samples lie on measured plane intersections; absent rays at anatomical cuts use nearest measured endpoints.", "Torso excludes distal arms beyond |X|.245; arm roots exclude torso belowY1.29. These anatomical cuts can have repeated endpoint samples.", "Disconnected hand sections use outermost radial hits across all digit contours; connecting samples encloses inter-finger gaps. Individual fingertips need separate digit profiles."], warnings }, null, 2));
