/** Build low-height collision footprints for the two staged Crownward castle meshes. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

type Point3 = readonly [number, number, number];
type Point2 = readonly [number, number];
type Triangle = readonly [Point3, Point3, Point3];
type Segment = readonly [Point2, Point2];
type Rect = Readonly<{ x: number; z: number; width: number; depth: number; height: number }>;

interface Plan {
  readonly assetId: string;
  readonly compositionId: "crownward_castle" | "crownward_fortress";
  readonly scale: number;
  readonly expectedTriangles: number;
  readonly targetWidth: number;
  readonly destination: "court" | "threshold";
  /** Centre of the deep opening found by the staged mesh's low-height +Z ray scan. */
  readonly gateHintX: number;
}

interface Grid {
  readonly minX: number;
  readonly minZ: number;
  readonly columns: number;
  readonly rows: number;
  readonly cells: Uint8Array;
}

interface GatePath {
  readonly cells: readonly (readonly [number, number])[];
  readonly points: readonly Point2[];
  readonly gateOuter: Point2;
  readonly gateInner: Point2;
  readonly court: Point2;
  readonly courtRadius: number;
}

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "..");
const stagingRoot = path.join(repositoryRoot, "test-results", "crownward-castles");
const catalogPath = path.join(directory, "crownward-castles", "catalog.json");
const generatedPath = path.join(repositoryRoot, "game", "src", "render", "compositions", "crownwardCastleCollision.ts");
const reportPath = path.join(stagingRoot, "castle-collision.svg");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// A cell is smaller than the player's diameter. The small surface pad closes sub-cell cracks;
// runtime collision applies the player's 0.35 m radius to these boxes separately.
const CELL = 0.4;
const SURFACE_PAD = 0.08;
const SLICES = [0.5, 1, 1.6] as const;
const COLLISION_HEIGHT = 2.2;
const EPSILON = 1e-6;

const plans: readonly Plan[] = [
  {
    assetId: "crownward_premade_castle",
    compositionId: "crownward_castle",
    scale: 19.6415,
    expectedTriangles: 13_860,
    targetWidth: 52,
    destination: "threshold",
    gateHintX: -4.3,
  },
  {
    assetId: "crownward_premade_fortress",
    compositionId: "crownward_fortress",
    scale: 28.6092,
    expectedTriangles: 4_524,
    targetWidth: 60,
    destination: "court",
    gateHintX: 0.5,
  },
];

class DisjointSet {
  private readonly parent: Int32Array;

  constructor(length: number) {
    this.parent = Int32Array.from({ length }, (_, index) => index);
  }

  find(value: number): number {
    let root = value;
    while (this.parent[root] !== root) root = this.parent[root]!;
    while (this.parent[value] !== value) {
      const next = this.parent[value]!;
      this.parent[value] = root;
      value = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
}

function transformPoint(matrix: readonly number[], values: ArrayLike<number>, index: number, scale: number): Point3 {
  const x = values[index * 3]!;
  const y = values[index * 3 + 1]!;
  const z = values[index * 3 + 2]!;
  return [
    (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) * scale,
    (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) * scale,
    (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) * scale,
  ];
}

async function triangleComponents(file: string, scale: number): Promise<readonly (readonly Triangle[])[]> {
  const document = await io.read(file);
  const components: Triangle[][] = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const attribute = primitive.getAttribute("POSITION");
      assert(attribute, `${file}: primitive has no POSITION attribute`);
      const positions = attribute.getArray();
      assert(positions, `${file}: POSITION data is not loaded`);
      const sourceIndices = primitive.getIndices()?.getArray();
      const indices = sourceIndices
        ? Array.from(sourceIndices)
        : Array.from({ length: attribute.getCount() }, (_, index) => index);
      assert.equal(indices.length % 3, 0, `${file}: incomplete triangle index buffer`);
      const sets = new DisjointSet(attribute.getCount());
      for (let index = 0; index < indices.length; index += 3) {
        sets.union(indices[index]!, indices[index + 1]!);
        sets.union(indices[index]!, indices[index + 2]!);
      }
      const grouped = new Map<number, Triangle[]>();
      for (let index = 0; index < indices.length; index += 3) {
        const a = indices[index]!;
        const triangle: Triangle = [
          transformPoint(matrix, positions, a, scale),
          transformPoint(matrix, positions, indices[index + 1]!, scale),
          transformPoint(matrix, positions, indices[index + 2]!, scale),
        ];
        const group = sets.find(a);
        const list = grouped.get(group);
        if (list) list.push(triangle);
        else grouped.set(group, [triangle]);
      }
      components.push(...grouped.values());
    }
  }
  return components;
}

function boundsOf(components: readonly (readonly Triangle[])[]) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const triangle of components.flat()) for (const [x, y, z] of triangle) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function sliceSegment(triangle: Triangle, y: number): Segment | null {
  const intersections: Point2[] = [];
  for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]] as const) {
    if (!((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))) continue;
    const amount = (y - a[1]) / (b[1] - a[1]);
    intersections.push([a[0] + (b[0] - a[0]) * amount, a[2] + (b[2] - a[2]) * amount]);
  }
  if (intersections.length !== 2) return null;
  const a = intersections[0]!;
  const b = intersections[1]!;
  return Math.hypot(a[0] - b[0], a[1] - b[1]) > EPSILON ? [a, b] : null;
}

function distanceToSegment(x: number, z: number, segment: Segment): number {
  const [[ax, az], [bx, bz]] = segment;
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  const amount = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
  return Math.hypot(x - (ax + dx * amount), z - (az + dz * amount));
}

function makeGrid(components: readonly (readonly Triangle[])[], bounds: ReturnType<typeof boundsOf>): Grid {
  const minX = Math.floor(bounds.minX / CELL) * CELL;
  const minZ = Math.floor(bounds.minZ / CELL) * CELL;
  const columns = Math.ceil((bounds.maxX - minX) / CELL);
  const rows = Math.ceil((bounds.maxZ - minZ) / CELL);
  const cells = new Uint8Array(columns * rows);
  for (const y of SLICES) {
    const sliced = components
      .map(component => component.map(triangle => sliceSegment(triangle, y)).filter((segment): segment is Segment => segment !== null))
      .filter(component => component.length > 0);
    for (let row = 0; row < rows; row++) {
      const z = minZ + (row + 0.5) * CELL;
      for (const component of sliced) {
        const crossings: number[] = [];
        for (const [[ax, az], [bx, bz]] of component) {
          if ((az <= z && bz > z) || (bz <= z && az > z)) crossings.push(ax + (bx - ax) * (z - az) / (bz - az));
        }
        crossings.sort((a, b) => a - b);
        const unique = crossings.filter((value, index) => index === 0 || Math.abs(value - crossings[index - 1]!) > EPSILON);
        for (let index = 0; index + 1 < unique.length; index += 2) {
          const left = unique[index]!;
          const right = unique[index + 1]!;
          const first = Math.max(0, Math.floor((left - minX) / CELL));
          const last = Math.min(columns - 1, Math.floor((right - minX) / CELL));
          for (let column = first; column <= last; column++) {
            const x = minX + (column + 0.5) * CELL;
            if (x >= left - EPSILON && x <= right + EPSILON) cells[row * columns + column] = 1;
          }
        }
      }
      // A mesh can contain a thin or open wall with no parity interior. Mark the sliced surface
      // itself even when the surrounding component cannot support an inside/outside parity fill.
      const allSegments = sliced.flat();
      for (const segment of allSegments) {
        const segmentMinX = Math.min(segment[0][0], segment[1][0]) - SURFACE_PAD;
        const segmentMaxX = Math.max(segment[0][0], segment[1][0]) + SURFACE_PAD;
        const segmentMinZ = Math.min(segment[0][1], segment[1][1]) - SURFACE_PAD;
        const segmentMaxZ = Math.max(segment[0][1], segment[1][1]) + SURFACE_PAD;
        if (z < segmentMinZ - CELL * 0.5 || z > segmentMaxZ + CELL * 0.5) continue;
        const first = Math.max(0, Math.floor((segmentMinX - minX) / CELL));
        const last = Math.min(columns - 1, Math.floor((segmentMaxX - minX) / CELL));
        for (let column = first; column <= last; column++) {
          const x = minX + (column + 0.5) * CELL;
          if (distanceToSegment(x, z, segment) <= SURFACE_PAD + CELL * Math.SQRT1_2) cells[row * columns + column] = 1;
        }
      }
    }
  }
  return { minX, minZ, columns, rows, cells };
}

function mergeRows(grid: Grid): Rect[] {
  const result: { start: number; end: number; firstRow: number; lastRow: number }[] = [];
  let active = new Map<string, { start: number; end: number; firstRow: number; lastRow: number }>();
  for (let row = 0; row <= grid.rows; row++) {
    const runs: { start: number; end: number }[] = [];
    if (row < grid.rows) {
      for (let column = 0; column < grid.columns;) {
        if (!grid.cells[row * grid.columns + column]) { column++; continue; }
        const start = column;
        while (column + 1 < grid.columns && grid.cells[row * grid.columns + column + 1]) column++;
        runs.push({ start, end: column++ });
      }
    }
    const next = new Map<string, { start: number; end: number; firstRow: number; lastRow: number }>();
    for (const run of runs) {
      const key = `${run.start}:${run.end}`;
      const prior = active.get(key);
      next.set(key, prior ? { ...prior, lastRow: row } : { ...run, firstRow: row, lastRow: row });
    }
    for (const [key, rectangle] of active) if (!next.has(key)) result.push(rectangle);
    active = next;
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return result.map(({ start, end, firstRow, lastRow }) => ({
    x: round(grid.minX + (start + end + 1) * CELL * 0.5),
    z: round(grid.minZ + (firstRow + lastRow + 1) * CELL * 0.5),
    width: round((end - start + 1) * CELL),
    depth: round((lastRow - firstRow + 1) * CELL),
    height: COLLISION_HEIGHT,
  }));
}

function findGatePath(grid: Grid, bounds: ReturnType<typeof boundsOf>, plan: Plan): GatePath {
  const marginRows = 5;
  const totalRows = grid.rows + marginRows;
  const centralLimit = (bounds.maxX - bounds.minX) * 0.28;
  const startRow = totalRows - 1;
  const straightDepth = 6;
  const occupied: Point2[] = [];
  for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) {
    if (grid.cells[row * grid.columns + column]) occupied.push([
      grid.minX + (column + 0.5) * CELL,
      grid.minZ + (row + 0.5) * CELL,
    ]);
  }
  const clearanceAt = (x: number, z: number) => {
    let clearance = Infinity;
    for (const [solidX, solidZ] of occupied) clearance = Math.min(clearance, Math.hypot(x - solidX, z - solidZ));
    return clearance - CELL * Math.SQRT1_2;
  };

  if (plan.destination === "threshold") {
    const gateColumn = Math.max(0, Math.min(grid.columns - 1, Math.round((plan.gateHintX - grid.minX) / CELL - 0.5)));
    const gateX = grid.minX + (gateColumn + 0.5) * CELL;
    let thresholdRow = grid.rows - 1;
    while (thresholdRow >= 0 && !grid.cells[thresholdRow * grid.columns + gateColumn]) thresholdRow--;
    // Stop one full raster cell before the first occupied cell. The resulting road endpoint has
    // enough room for the runtime player radius and does not claim the dense castle is enterable.
    const lastOpenRow = Math.min(grid.rows, thresholdRow + 2);
    assert(lastOpenRow < grid.rows, "castle gate hint does not meet the staged mesh inside its bounds");
    const cells: [number, number][] = [];
    for (let row = startRow; row >= lastOpenRow; row--) cells.push([gateColumn, row]);
    const gateOuter: Point2 = [gateX, grid.minZ + (startRow + 0.5) * CELL];
    const gateInner: Point2 = [gateX, grid.minZ + (lastOpenRow + 0.5) * CELL];
    return {
      cells,
      points: [gateOuter, gateInner],
      gateOuter,
      gateInner,
      court: gateInner,
      courtRadius: clearanceAt(...gateInner),
    };
  }

  const visited = new Int32Array(grid.columns * totalRows).fill(-1);
  const queue: number[] = [];
  const gateColumns: number[] = [];
  for (let column = 0; column < grid.columns; column++) {
    const x = grid.minX + (column + 0.5) * CELL;
    if (Math.abs(x) > centralLimit) continue;
    let clear = true;
    for (let row = 0; row < grid.rows; row++) {
      const z = grid.minZ + (row + 0.5) * CELL;
      if (z <= bounds.maxZ + EPSILON && z >= bounds.maxZ - straightDepth && grid.cells[row * grid.columns + column]) {
        clear = false;
        break;
      }
    }
    if (clear) gateColumns.push(column);
  }
  assert(gateColumns.length, "no +Z gate retains a straight six-metre passage");
  gateColumns.sort((a, b) => {
    const ax = Math.abs(grid.minX + (a + 0.5) * CELL - plan.gateHintX);
    const bx = Math.abs(grid.minX + (b + 0.5) * CELL - plan.gateHintX);
    return ax - bx;
  });
  const gateColumn = gateColumns[0]!;
  const gateX = grid.minX + (gateColumn + 0.5) * CELL;
  const start = startRow * grid.columns + gateColumn;
  visited[start] = start;
  queue.push(start);
  const open = (column: number, row: number) => row >= grid.rows || grid.cells[row * grid.columns + column] === 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const index = queue[cursor]!;
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nextColumn = column + dc;
      const nextRow = row + dr;
      if (nextColumn < 0 || nextColumn >= grid.columns || nextRow < 0 || nextRow >= totalRows) continue;
      const x = grid.minX + (nextColumn + 0.5) * CELL;
      // Keep this proof within the central gate band. It cannot sneak around an outer corner.
      if (Math.abs(x) > centralLimit || !open(nextColumn, nextRow)) continue;
      const next = nextRow * grid.columns + nextColumn;
      if (visited[next] !== -1) continue;
      visited[next] = index;
      queue.push(next);
    }
  }
  let target = -1;
  let courtRadius = -Infinity;
  let targetBias = Infinity;
  for (let index = 0; index < grid.columns * grid.rows; index++) {
    if (visited[index] === -1) continue;
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    const x = grid.minX + (column + 0.5) * CELL;
    const z = grid.minZ + (row + 0.5) * CELL;
    if (bounds.maxZ - z < straightDepth) continue;
    const clearance = clearanceAt(x, z);
    const bias = Math.hypot(x, z);
    if (clearance > courtRadius + EPSILON || Math.abs(clearance - courtRadius) <= EPSILON && bias < targetBias) {
      target = index;
      courtRadius = clearance;
      targetBias = bias;
    }
  }
  assert(target >= 0, "no +Z gate path reaches the castle interior");
  const cells: [number, number][] = [];
  for (let value = target;; value = visited[value]!) {
    const row = Math.floor(value / grid.columns);
    cells.push([value % grid.columns, row]);
    if (visited[value] === value) break;
  }
  cells.reverse();
  const detailed = cells.map(([column, row]): Point2 => [
    grid.minX + (column + 0.5) * CELL,
    grid.minZ + (row + 0.5) * CELL,
  ]);
  const points = detailed.filter((point, index) => {
    if (index === 0 || index === detailed.length - 1) return true;
    const before = detailed[index - 1]!;
    const after = detailed[index + 1]!;
    return Math.sign(point[0] - before[0]) !== Math.sign(after[0] - point[0])
      || Math.sign(point[1] - before[1]) !== Math.sign(after[1] - point[1]);
  });
  const gateOuter: Point2 = [gateX, bounds.maxZ + marginRows * CELL - CELL * 0.5];
  const gateInner: Point2 = [gateX, bounds.maxZ - straightDepth];
  const court = detailed[detailed.length - 1]!;
  return { cells, points, gateOuter, gateInner, court, courtRadius };
}

function generatedSource(records: ReadonlyMap<Plan["compositionId"], readonly Rect[]>): string {
  const lines = [
    "/** Generated by tools/build-castle-collision.ts from the staged Crownward GLBs. */",
    "export interface CrownwardCastleCollisionRect {",
    "  readonly x: number;",
    "  readonly z: number;",
    "  readonly width: number;",
    "  readonly depth: number;",
    "  readonly height: number;",
    "}",
    "",
    'export type CrownwardCastleCollisionId = "crownward_castle" | "crownward_fortress";',
    "",
    "// Local metres. Each model is centred on X/Z zero, rests at Y zero, and faces +Z.",
    "export const CROWNWARD_CASTLE_COLLISION: Readonly<Record<",
    "  CrownwardCastleCollisionId,",
    "  readonly CrownwardCastleCollisionRect[]",
    ">> = {",
  ];
  for (const plan of plans) {
    lines.push(`  ${plan.compositionId}: [`);
    for (const rectangle of records.get(plan.compositionId) ?? []) {
      lines.push(`    { x: ${rectangle.x}, z: ${rectangle.z}, width: ${rectangle.width}, depth: ${rectangle.depth}, height: ${rectangle.height} },`);
    }
    lines.push("  ],");
  }
  lines.push("};", "");
  return lines.join("\n");
}

function svgReport(results: readonly { plan: Plan; bounds: ReturnType<typeof boundsOf>; grid: Grid; path: GatePath; rectangles: readonly Rect[] }[]): string {
  const panelWidth = 440;
  const panelHeight = 560;
  const output: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth * results.length}" height="${panelHeight}" viewBox="0 0 ${panelWidth * results.length} ${panelHeight}">`,
    '<rect width="100%" height="100%" fill="#f4f0e8"/>',
    '<style>text{font-family:ui-monospace,monospace;fill:#18201f}.title{font-size:17px;font-weight:700}.note{font-size:11px}.cell{fill:#344846}.path{fill:none;stroke:#d34a32;stroke-width:2.4;stroke-linejoin:round;stroke-linecap:round}.bounds{fill:none;stroke:#1f8585;stroke-width:1.5;stroke-dasharray:5 3}</style>',
  ];
  results.forEach(({ plan, bounds, grid, path, rectangles }, panel) => {
    const offsetX = panel * panelWidth;
    const scale = Math.min(6.2, 390 / Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ + 4));
    const centreX = offsetX + panelWidth / 2;
    const centreZ = 278;
    const sx = (x: number) => centreX + x * scale;
    const sy = (z: number) => centreZ - z * scale;
    output.push(`<text class="title" x="${offsetX + 22}" y="28">${plan.compositionId}</text>`);
    output.push(`<text class="note" x="${offsetX + 22}" y="47">cell ${CELL}m; slice ${SLICES.join(", ")}m; surface pad ${SURFACE_PAD}m</text>`);
    output.push(`<rect class="bounds" x="${sx(bounds.minX).toFixed(2)}" y="${sy(bounds.maxZ).toFixed(2)}" width="${((bounds.maxX - bounds.minX) * scale).toFixed(2)}" height="${((bounds.maxZ - bounds.minZ) * scale).toFixed(2)}"/>`);
    for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) {
      if (!grid.cells[row * grid.columns + column]) continue;
      const x = grid.minX + column * CELL;
      const z = grid.minZ + (row + 1) * CELL;
      output.push(`<rect class="cell" x="${sx(x).toFixed(2)}" y="${sy(z).toFixed(2)}" width="${(CELL * scale + 0.08).toFixed(2)}" height="${(CELL * scale + 0.08).toFixed(2)}"/>`);
    }
    output.push(`<polyline class="path" points="${path.points.map(([x, z]) => `${sx(x).toFixed(2)},${sy(z).toFixed(2)}`).join(" ")}"/>`);
    const gate = path.gateInner;
    const court = path.court;
    output.push(`<circle cx="${sx(gate[0]).toFixed(2)}" cy="${sy(gate[1]).toFixed(2)}" r="4" fill="#f4c95d" stroke="#18201f"/>`);
    output.push(`<circle cx="${sx(court[0]).toFixed(2)}" cy="${sy(court[1]).toFixed(2)}" r="4" fill="#d34a32" stroke="#18201f"/>`);
    output.push(`<text class="note" x="${offsetX + 22}" y="520">${rectangles.length} boxes; occupied ${(100 * grid.cells.reduce((sum, value) => sum + value, 0) / grid.cells.length).toFixed(1)}%</text>`);
    output.push(`<text class="note" x="${offsetX + 22}" y="538">gate (${path.gateOuter[0].toFixed(1)}, ${path.gateOuter[1].toFixed(1)}) to (${gate[0].toFixed(1)}, ${gate[1].toFixed(1)}); ${plan.destination} (${court[0].toFixed(1)}, ${court[1].toFixed(1)}) r=${path.courtRadius.toFixed(1)}m</text>`);
  });
  output.push("</svg>", "");
  return output.join("\n");
}

const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { files: Record<string, string> };
const records = new Map<Plan["compositionId"], readonly Rect[]>();
const results: { plan: Plan; bounds: ReturnType<typeof boundsOf>; grid: Grid; path: GatePath; rectangles: readonly Rect[] }[] = [];
for (const plan of plans) {
  const relativeFile = catalog.files[plan.assetId];
  assert(relativeFile, `${plan.assetId}: missing catalog file`);
  const file = path.resolve(path.dirname(catalogPath), relativeFile);
  const components = await triangleComponents(file, plan.scale);
  const triangleCount = components.reduce((total, component) => total + component.length, 0);
  assert.equal(triangleCount, plan.expectedTriangles, `${plan.assetId}: triangle count changed`);
  const bounds = boundsOf(components);
  assert(Math.abs(bounds.maxX - bounds.minX - plan.targetWidth) < 0.02, `${plan.assetId}: scaled width changed`);
  assert(Math.abs(bounds.minY) < 0.001, `${plan.assetId}: base moved away from Y=0`);
  const grid = makeGrid(components, bounds);
  const occupied = grid.cells.reduce((total, value) => total + value, 0);
  assert(occupied / grid.cells.length < 0.7, `${plan.assetId}: collision sealed most of its bounding box`);
  const rectangles = mergeRows(grid);
  const gatePath = findGatePath(grid, bounds, plan);
  assert(rectangles.length > 10 && rectangles.length < 500, `${plan.assetId}: suspicious rectangle count ${rectangles.length}`);
  if (plan.compositionId === "crownward_fortress") {
    assert(gatePath.courtRadius >= 3, `${plan.assetId}: inner court no longer has three metres of radial clearance`);
  }
  records.set(plan.compositionId, rectangles);
  results.push({ plan, bounds, grid, path: gatePath, rectangles });
}

await mkdir(path.dirname(generatedPath), { recursive: true });
await mkdir(path.dirname(reportPath), { recursive: true });
await Promise.all([
  writeFile(generatedPath, generatedSource(records)),
  writeFile(reportPath, svgReport(results)),
]);

for (const { plan, bounds, grid, path: gatePath, rectangles } of results) {
  const occupied = grid.cells.reduce((total, value) => total + value, 0);
  console.log(`${plan.compositionId}: ${rectangles.length} boxes, ${(occupied / grid.cells.length * 100).toFixed(1)}% occupied`);
  console.log(`  straight gate (${gatePath.gateOuter[0].toFixed(2)}, ${gatePath.gateOuter[1].toFixed(2)}) -> (${gatePath.gateInner[0].toFixed(2)}, ${gatePath.gateInner[1].toFixed(2)})`);
  console.log(`  reachable ${plan.destination} (${gatePath.court[0].toFixed(2)}, ${gatePath.court[1].toFixed(2)}), clear radius ${gatePath.courtRadius.toFixed(2)} m`);
  console.log(`  bounds ${[(bounds.maxX - bounds.minX), (bounds.maxY - bounds.minY), (bounds.maxZ - bounds.minZ)].map(value => value.toFixed(3)).join(" x ")} m`);
}
console.log(`wrote ${path.relative(repositoryRoot, generatedPath)}`);
console.log(`wrote ${path.relative(repositoryRoot, reportPath)}`);
