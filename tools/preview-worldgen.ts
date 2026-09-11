import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import {
  sampleOrganicBiomeWeights,
  sampleOrganicCoast,
  sampleOrganicContour,
} from "../game/src/world/organicFields.js";
import type { RegionId } from "../game/src/contracts.js";
import type { Rect } from "../game/src/render/scene.js";

type Point = readonly [number, number];
type Rgb = readonly [number, number, number];

const DEFAULT_OUTPUT = path.resolve("runs/local-worldgen/worldgen-preview.svg");
const EDGE_STEP = 10;
const RASTER_STEP = 8;
const SEABED: Rgb = [49, 71, 63];

// These are visual-field colours, not the semantic RegionId palette. Keep this list limited to
// the currently authored fields so retired ids cannot quietly become visual biomes again.
const BIOME_COLOURS: Record<string, string> = {
  fallowmarch: "#a7ad72",
  vellenwood: "#56765b",
  karrowmoor: "#7d7865",
  kilnhalt: "#9b7a54",
  wilderness: "#646a78",
};

const FALLBACK_BIOME_COLOUR = "#8a8779";

function biomeColour(id: string): string {
  return BIOME_COLOURS[id] ?? FALLBACK_BIOME_COLOUR;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

function pointsAttribute(points: readonly Point[]): string {
  return points.map(([x, z]) => `${x.toFixed(2)},${(-z).toFixed(2)}`).join(" ");
}

function sampleEdge(from: Point, to: Point, step = EDGE_STEP): Point[] {
  const count = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
  return Array.from({ length: count }, (_, index) => {
    const t = index / count;
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t] as const;
  });
}

function rectContour(rect: Rect): Point[] {
  return [
    ...sampleEdge([rect.minX, rect.maxZ], [rect.maxX, rect.maxZ]),
    ...sampleEdge([rect.maxX, rect.maxZ], [rect.maxX, rect.minZ]),
    ...sampleEdge([rect.maxX, rect.minZ], [rect.minX, rect.minZ]),
    ...sampleEdge([rect.minX, rect.minZ], [rect.minX, rect.maxZ]),
  ];
}

function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function colour(weights: readonly { id: RegionId; weight: number }[], coastDescent: number): string {
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const sample of weights) {
    const swatch = rgb(biomeColour(sample.id));
    red += swatch[0] * sample.weight;
    green += swatch[1] * sample.weight;
    blue += swatch[2] * sample.weight;
  }
  const amount = Math.max(0, Math.min(1, coastDescent)) * 0.86;
  red += (SEABED[0] - red) * amount;
  green += (SEABED[1] - green) * amount;
  blue += (SEABED[2] - blue) * amount;
  return `rgb(${Math.round(red)} ${Math.round(green)} ${Math.round(blue)})`;
}

function svgLine(from: Point, to: Point, attributes: string): string {
  return `<line x1="${from[0].toFixed(2)}" y1="${(-from[1]).toFixed(2)}" `
    + `x2="${to[0].toFixed(2)}" y2="${(-to[1]).toFixed(2)}" ${attributes} />`;
}

function corridorOverlay(
  from: Point,
  to: Point,
  halfWidth: number,
  colourValue: string,
): string {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  const normalX = length > 0 ? -dz / length : 0;
  const normalZ = length > 0 ? dx / length : halfWidth;
  const midpoint: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const capStart: Point = [midpoint[0] - normalX * halfWidth, midpoint[1] - normalZ * halfWidth];
  const capEnd: Point = [midpoint[0] + normalX * halfWidth, midpoint[1] + normalZ * halfWidth];
  return `<g fill="none" stroke-linecap="round">
    ${svgLine(from, to, `stroke="${colourValue}" stroke-width="${(halfWidth * 2).toFixed(2)}" opacity="0.11"`)}
    ${svgLine(from, to, `stroke="${colourValue}" stroke-width="1.25" stroke-dasharray="5 4" opacity="0.72"`)}
    ${svgLine(capStart, capEnd, `stroke="${colourValue}" stroke-width="1" opacity="0.62"`)}
  </g>`;
}

function intentOverlay(
  fieldId: string,
  anchor: { id: string; centre: readonly [number, number]; radius: number; holdRadius?: number },
): string {
  const [x, z] = anchor.centre;
  const holdRadius = Math.max(0.000_001, Math.abs(anchor.holdRadius ?? anchor.radius * 0.2));
  const label = escapeXml(`${fieldId} · ${anchor.id}`);
  const colourValue = biomeColour(fieldId);
  return `<g class="biome-intent" data-biome="${escapeXml(fieldId)}" data-intent="${escapeXml(anchor.id)}">
    <circle cx="${x.toFixed(2)}" cy="${(-z).toFixed(2)}" r="${Math.abs(anchor.radius).toFixed(2)}" fill="none" stroke="${colourValue}" stroke-width="1.15" stroke-dasharray="6 3" opacity="0.76" />
    <circle cx="${x.toFixed(2)}" cy="${(-z).toFixed(2)}" r="${holdRadius.toFixed(2)}" fill="${colourValue}" fill-opacity="0.18" stroke="${colourValue}" stroke-width="1.25" opacity="0.92" />
    <path d="M${(x - 4).toFixed(2)},${(-z).toFixed(2)}h8 M${x.toFixed(2)},${(-z - 4).toFixed(2)}v8" stroke="#f8f0d4" stroke-width="1.2" opacity="0.95" />
    <text x="${(x + 5).toFixed(2)}" y="${( -z - 5).toFixed(2)}" fill="#f8f0d4" font-family="system-ui, sans-serif" font-size="6.4" paint-order="stroke" stroke="#1b2928" stroke-width="1.8">${label}</text>
  </g>`;
}

/** Write a dependency-free plan view sampled from the same biome and coast functions as the game. */
export async function writeWorldgenPreview(outputPath = DEFAULT_OUTPUT): Promise<string> {
  const spec = buildWorldTerrainSpec();
  const coastSpec = spec.coast;
  const biomes = spec.biomes;
  if (!coastSpec || !biomes) {
    throw new Error("World generation preview needs both coast and biome settings.");
  }
  const output = path.resolve(outputPath);
  if (path.extname(output).toLowerCase() !== ".svg") {
    throw new Error(`World generation previews must use an .svg output path: ${output}`);
  }

  const padding = coastSpec.collar + 14;
  const viewX = spec.bounds.minX - padding;
  const viewY = -spec.bounds.maxZ - padding;
  const viewWidth = spec.bounds.maxX - spec.bounds.minX + padding * 2;
  const viewHeight = spec.bounds.maxZ - spec.bounds.minZ + padding * 2;
  const raster: string[] = [];
  const minX = spec.bounds.minX - coastSpec.collar;
  const maxX = spec.bounds.maxX + coastSpec.collar;
  const minZ = spec.bounds.minZ - coastSpec.collar;
  const maxZ = spec.bounds.maxZ + coastSpec.collar;
  const columns = Math.ceil((maxX - minX) / RASTER_STEP);
  const rows = Math.ceil((maxZ - minZ) / RASTER_STEP);
  const winners: (RegionId | null)[] = new Array(columns * rows).fill(null);
  const winnerCounts = new Map<RegionId, number>();
  let renderedSamples = 0;

  for (let row = 0; row < rows; row += 1) {
    const z = minZ + row * RASTER_STEP;
    for (let column = 0; column < columns; column += 1) {
      const x = minX + column * RASTER_STEP;
      const width = Math.min(RASTER_STEP, maxX - x);
      const depth = Math.min(RASTER_STEP, maxZ - z);
      const sampleX = x + width / 2;
      const sampleZ = z + depth / 2;
      const playable = sampleX >= spec.bounds.minX && sampleX <= spec.bounds.maxX
        && sampleZ >= spec.bounds.minZ && sampleZ <= spec.bounds.maxZ;
      const coast = sampleOrganicCoast(sampleX, sampleZ, spec.bounds, coastSpec);
      if (!playable && !coast.land) continue;
      // The scene evaluates the biome field at the actual rendered position. Keep outside coast
      // colours continuous with that behavior instead of snapping every collar sample to the
      // nearest playable boundary point.
      const weights = sampleOrganicBiomeWeights(sampleX, sampleZ, biomes);
      winners[row * columns + column] = weights.reduce(
        (best, sample) => sample.weight > best.weight ? sample : best,
        weights[0]!,
      ).id;
      const winner = winners[row * columns + column]!;
      winnerCounts.set(winner, (winnerCounts.get(winner) ?? 0) + 1);
      renderedSamples += 1;
      raster.push(
        `<rect x="${x.toFixed(2)}" y="${(-z - depth).toFixed(2)}" `
        + `width="${width.toFixed(2)}" height="${depth.toFixed(2)}" `
        + `fill="${colour(weights, playable ? 0 : coast.descent)}" />`,
      );
    }
  }

  const visualBoundaries: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const z = minZ + row * RASTER_STEP;
    for (let column = 0; column < columns; column += 1) {
      const winner = winners[row * columns + column];
      if (!winner) continue;
      const x = minX + column * RASTER_STEP;
      if (column + 1 < columns) {
        const east = winners[row * columns + column + 1];
        if (east && east !== winner) {
          visualBoundaries.push(`M${x + RASTER_STEP},${-z}v${-RASTER_STEP}`);
        }
      }
      if (row + 1 < rows) {
        const north = winners[(row + 1) * columns + column];
        if (north && north !== winner) {
          visualBoundaries.push(`M${x},${-z - RASTER_STEP}h${RASTER_STEP}`);
        }
      }
    }
  }

  const semanticRegions = spec.regions.map((region) => {
    const centreX = (region.rect.minX + region.rect.maxX) / 2;
    const centreZ = (region.rect.minZ + region.rect.maxZ) / 2;
    return `<polygon points="${pointsAttribute(rectContour(region.rect))}" fill="none" `
      + `stroke="${biomeColour(region.regionId)}" stroke-width="0.8" stroke-dasharray="5 4" opacity="0.44" />\n`
      + `<text x="${centreX}" y="${-centreZ}" text-anchor="middle" fill="#e7ddc0" opacity="0.58" `
      + `font-family="system-ui, sans-serif" font-size="8" font-weight="600" paint-order="stroke" `
      + `stroke="#25362e" stroke-width="2">${escapeXml(region.regionId)}</text>`;
  }).join("\n");

  const waters = (spec.basins ?? []).map((basin) => {
    const outer = sampleOrganicContour(basin.x, basin.z, basin.outerRadius, basin.shape);
    const shore = sampleOrganicContour(basin.x, basin.z, basin.shoreRadius, basin.shape);
    return `<polygon points="${pointsAttribute(outer)}" fill="none" stroke="#354a41" stroke-dasharray="3 3" />\n`
      + `<polygon points="${pointsAttribute(shore)}" fill="#3d7180" stroke="#b8c78d" />`;
  }).join("\n");

  const biomeOverlays = biomes.fields.map((field) => {
    const corridorLines = (field.corridors ?? []).map((corridor) => corridorOverlay(
      corridor.from,
      corridor.to,
      Math.abs(corridor.halfWidth),
      biomeColour(field.id),
    )).join("\n");
    const intents = field.anchors.map((anchor) => intentOverlay(field.id, anchor)).join("\n");
    return `<g data-biome-field="${escapeXml(field.id)}">${corridorLines}\n${intents}</g>`;
  }).join("\n");

  const legendX = viewX + 10;
  const legendY = viewY + 12;
  const legendHeight = 98;
  const legendRows = biomes.fields.map((field, index) => (
    `<rect x="${legendX + 8}" y="${legendY + 27 + index * 10}" width="7" height="7" fill="${biomeColour(field.id)}" />`
      + `<text x="${legendX + 19}" y="${legendY + 34 + index * 10}">${escapeXml(field.id)}</text>`
  )).join("\n");

  const coverage = biomes.fields.map((field) => {
    const count = winnerCounts.get(field.id) ?? 0;
    const percentage = renderedSamples > 0 ? count / renderedSamples * 100 : 0;
    return `${field.id} ${percentage.toFixed(1)}%`;
  }).join(", ");
  const centreCensus = biomes.fields.flatMap((field) => field.anchors.map((anchor) => {
    const weights = sampleOrganicBiomeWeights(anchor.centre[0], anchor.centre[1], biomes);
    const ownIndex = weights.findIndex((sample) => sample.id === field.id);
    const own = ownIndex >= 0 ? weights[ownIndex]!.weight : 0;
    const runnerUp = weights.reduce((best, sample, index) => (
      index === ownIndex ? best : Math.max(best, sample.weight)
    ), 0);
    const margin = own - runnerUp;
    return `${field.id}:${anchor.id} ${own.toFixed(3)} (margin ${margin.toFixed(3)})`;
  }));

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}" width="1200" height="760">
  <rect x="${viewX}" y="${viewY}" width="${viewWidth}" height="${viewHeight}" fill="#173846" />
  <g shape-rendering="crispEdges">${raster.join("")}</g>
  <path d="${visualBoundaries.join("")}" fill="none" stroke="#192b28" stroke-width="0.9" opacity="0.68" />
  <g stroke-linejoin="round">${semanticRegions}</g>
  <polygon points="${pointsAttribute(rectContour(spec.bounds))}" fill="none" stroke="#e8dcae" stroke-width="0.9" stroke-dasharray="7 5" opacity="0.54" />
  <g stroke-width="1.25" stroke-linejoin="round">${waters}</g>
  ${biomeOverlays}
  <g font-family="system-ui, sans-serif" font-size="7.5" fill="#f6f0d6" paint-order="stroke" stroke="#1b2928" stroke-width="1.5">
    <rect x="${legendX}" y="${legendY}" width="185" height="${legendHeight}" rx="3" fill="#122a2b" fill-opacity="0.9" stroke="#d5cda9" stroke-width="0.7" />
    <text x="${legendX + 8}" y="${legendY + 13}" font-size="10" font-weight="700" stroke-width="2">Corealm visual fields</text>
    <text x="${legendX + 8}" y="${legendY + 22}" font-size="7" stroke-width="1.5">blended climate raster + winner seams</text>
    ${legendRows}
    <text x="${legendX + 8}" y="${legendY + 65}" font-size="7" stroke-width="1.5">dashed circle: influence  ·  inner ring: hold</text>
    <text x="${legendX + 8}" y="${legendY + 75}" font-size="7" stroke-width="1.5">wide band: corridor half-width</text>
    <text x="${legendX + 8}" y="${legendY + 85}" font-size="7" stroke-width="1.5">dashed bounds: semantic ownership / play area</text>
  </g>
</svg>
`;

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, svg, "utf8");
  if (import.meta.url === commandEntry) {
    console.log(`Winner coverage (${renderedSamples} raster samples): ${coverage}`);
    console.log(`Authored intent centres (${centreCensus.length}):`);
    for (const line of centreCensus) console.log(`  ${line}`);
  }
  return output;
}

const commandEntry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === commandEntry) {
  const output = await writeWorldgenPreview(process.argv[2]);
  console.log(`Wrote world generation preview to ${output}`);
}
