import { useMemo } from "react";
import { WORLD_MAP_DETAIL_RENDITIONS } from "../../../game/src/generated/worldMapFingerprint.js";
import { gameUrl } from "../model/gameUrl.js";
import { IMAGE_BOX, boxFraction, cropPosition, zAtFraction } from "../model/worldMap.js";
import { useReferenceIndex } from "../model/refs.js";
import { contentRows } from "../model/rows.js";
import { cn } from "../lib/utils.js";

/*
  A record's places on the world map: a crop of the map fitted around every point, each point a
  pin with its radius drawn to scale. The creature page shows where it spawns, the NPC page where
  it stands. Clicking a pin opens that place on the full map; clicking the ground opens the map
  where it was clicked.
*/

export interface MapPoint { id: string; x: number; z: number; label: string; radius?: number; selected?: boolean; /** The world map route that opens this place (`locations:fallowmarch/bracken_pit`). */ target?: string; /** A short mark drawn in the pin (a stage number). */ mark?: string }

const ASPECT = 16 / 7;
/** Never zoom in past this many metres across, so one pin still shows its surroundings. */
const MIN_SPAN = 320;
const PAD = 0.22;
/** Half-metre pixels: crops a few hundred metres across still read as ground, not blur. */
const IMAGE = WORLD_MAP_DETAIL_RENDITIONS.find(rendition => rendition.id === "detail-3300") ?? WORLD_MAP_DETAIL_RENDITIONS.at(-1)!;

/*
  Labels: a handful of pins are named on the map; past three, names would pile on each other, so a
  name shows when its pin is hovered or focused (and is always its tooltip).
*/
export function PointsMap({ points, onOpen, onOpenAt, className, labels, caption }: { points: readonly MapPoint[]; onOpen?: (point: MapPoint) => void; onOpenAt?: (x: number, z: number) => void; className?: string; labels?: "always" | "hover"; /** Names the map when it is not the overworld ("Fairy realm"). */ caption?: string }) {
  const { index } = useReferenceIndex();
  // Region outlines from the world file, for the realms that have no drawn map.
  const regions = useMemo(() => {
    const world = index.collections.get("worldRegions");
    return (world ? contentRows(world) : []).flatMap(row => {
      const bounds = row.bounds as { min?: number[]; max?: number[] } | undefined;
      const [x0, z0] = bounds?.min ?? [], [x1, z1] = bounds?.max ?? [];
      return typeof x0 === "number" && typeof z0 === "number" && typeof x1 === "number" && typeof z1 === "number" ? [{ id: String(row.id), name: String(row.name ?? row.id), x0, z0, x1, z1 }] : [];
    });
  }, [index]);
  const view = useMemo(() => {
    if (!points.length) return undefined;
    const xs = points.map(point => point.x), zs = points.map(point => point.z);
    const rs = points.map(point => point.radius ?? 0);
    let minX = Math.min(...xs.map((x, i) => x - rs[i]!)), maxX = Math.max(...xs.map((x, i) => x + rs[i]!));
    let minZ = Math.min(...zs.map((z, i) => z - rs[i]!)), maxZ = Math.max(...zs.map((z, i) => z + rs[i]!));
    let spanX = Math.max(MIN_SPAN, (maxX - minX) * (1 + PAD * 2));
    let spanZ = Math.max(MIN_SPAN / ASPECT, (maxZ - minZ) * (1 + PAD * 2));
    // Keep the crop in the box's aspect so the image is not stretched.
    if (spanX / spanZ > ASPECT) spanZ = spanX / ASPECT; else spanX = spanZ * ASPECT;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    return { x0: cx - spanX / 2, z0: cz - spanZ / 2, spanX, spanZ };
  }, [points]);
  if (!view) return null;
  // Names are drawn only when they cannot land on each other: three pins at most, well apart.
  const apart = points.every((a, i) => points.every((b, j) => j <= i || Math.hypot((a.x - b.x) / view.spanX, (a.z - b.z) / view.spanZ) > 0.18));
  const hoverLabels = (labels ?? (points.length <= 3 && apart ? "always" : "hover")) === "hover";
  // Only the overworld has a drawn map; a place elsewhere (the fairy realm) is pinned on a plain grid.
  const x1 = view.x0 + view.spanX, z1 = view.z0 + view.spanZ;
  const drawn = !(x1 < IMAGE_BOX.x0 || view.x0 > IMAGE_BOX.x0 + IMAGE_BOX.spanX || z1 < IMAGE_BOX.z0 || view.z0 > IMAGE_BOX.z0 + IMAGE_BOX.spanZ);
  const px = (x: number) => boxFraction(view, x, 0).u * 100;
  const pz = (z: number) => boxFraction(view, 0, z).v * 100;
  const offset = cropPosition(view);
  const grid = `${(40 / view.spanX) * 100}%`;
  const style = drawn ? {
    aspectRatio: String(ASPECT),
    backgroundImage: `url(${gameUrl(IMAGE.path)})`,
    backgroundSize: `${(IMAGE_BOX.spanX / view.spanX) * 100}% ${(IMAGE_BOX.spanZ / view.spanZ) * 100}%`,
    backgroundPosition: `${offset.u * 100}% ${offset.v * 100}%`,
  } : {
    aspectRatio: String(ASPECT),
    backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
    backgroundSize: `${grid} ${(40 / view.spanZ) * 100}%`,
  };
  const scale = Math.round(view.spanX);
  return <div className={cn("points-map relative w-full cursor-crosshair overflow-hidden rounded-md border border-border bg-art bg-no-repeat [container-type:inline-size] focus-within:border-primary", className)} style={style} role="img" aria-label={`Map of ${points.length} ${points.length === 1 ? "place" : "places"}`}
    onClick={event => { if (!onOpenAt || event.target !== event.currentTarget) return; const box = event.currentTarget.getBoundingClientRect(); onOpenAt(view.x0 + ((event.clientX - box.left) / box.width) * view.spanX, zAtFraction(view, (event.clientY - box.top) / box.height)); }}>
    {!drawn && regions.filter(region => region.x1 > view.x0 && region.x0 < x1 && region.z1 > view.z0 && region.z0 < z1).map(region => {
      // Clipped to the crop, so the name sits in the visible part of the region. `top` is the region's north edge.
      const west = Math.max(region.x0, view.x0), east = Math.min(region.x1, x1), south = Math.max(region.z0, view.z0), north = Math.min(region.z1, z1);
      return <span key={region.id} className="pointer-events-none absolute border border-dashed border-muted-foreground/40 bg-secondary/50"
        style={{ left: `${px(west)}%`, top: `${pz(north)}%`, width: `${((east - west) / view.spanX) * 100}%`, height: `${((north - south) / view.spanZ) * 100}%` }}>
        <span className="absolute bottom-1 left-1.5 text-[11px] font-medium text-muted-foreground">{region.name}</span>
      </span>;
    })}
    {points.map(point => <button type="button" key={point.id} className="group absolute grid size-0 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center overflow-visible [&>*]:[grid-area:1/1]" style={{ left: `${px(point.x)}%`, top: `${pz(point.z)}%` }} title={point.label} aria-label={point.label} onClick={() => onOpen?.(point)}>
      {point.radius ? <span className="pointer-events-none aspect-square rounded-full border border-[hsl(38_80%_65%/0.7)] bg-[hsl(38_80%_60%/0.18)]" style={{ width: `${(point.radius * 2 / view.spanX) * 100}cqw` }} /> : null}
      <span className={cn("grid place-items-center rounded-full bg-primary font-mono font-semibold text-primary-foreground shadow-[0_0_0_2px_#0009,0_0_0_3px_#fff8] transition-transform group-hover:scale-125 group-focus-visible:scale-125", point.mark ? "size-4 text-[10px]" : "size-2.5", point.selected && "scale-125")}>{point.mark}</span>
      <span className={cn("pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 text-[11px] font-semibold whitespace-nowrap text-white [text-shadow:0_0_3px_#000,0_0_6px_#000]", point.mark ? "top-3" : "top-2", hoverLabels && "hidden group-hover:block group-focus-visible:block")}>{point.label}</span>
    </button>)}
    {(caption || !drawn) && <span className="pointer-events-none absolute top-1.5 left-2 text-[11px] font-medium text-muted-foreground">{caption ?? "No drawn map here"}{!drawn && caption ? " · schematic" : ""}</span>}
    <span className="pointer-events-none absolute right-1.5 bottom-1 font-mono text-[11px] text-white [text-shadow:0_0_3px_#000]">{scale} m across</span>
  </div>;
}
