import { useMemo } from "react";
import { WORLD_MAP_DETAIL_RENDITIONS, WORLD_MAP_IMAGE_BOUNDS } from "../../../game/src/generated/worldMapFingerprint.js";
import { gameUrl } from "../model/gameUrl.js";

/*
  A record's places on the world map: a crop of the map fitted around every point, each point a
  pin with its radius drawn to scale. The creature page shows where it spawns, the NPC page where
  it stands. Clicking a pin opens that place on the full map; clicking the ground opens the map
  where it was clicked.
*/

export interface MapPoint { id: string; x: number; z: number; label: string; radius?: number; selected?: boolean }

const ASPECT = 16 / 7;
/** Never zoom in past this many metres across, so one pin still shows its surroundings. */
const MIN_SPAN = 320;
const PAD = 0.22;
/** Half-metre pixels: crops a few hundred metres across still read as ground, not blur. */
const IMAGE = WORLD_MAP_DETAIL_RENDITIONS.find(rendition => rendition.id === "detail-3300") ?? WORLD_MAP_DETAIL_RENDITIONS.at(-1)!;

export function PointsMap({ points, onOpen, onOpenAt, className = "" }: { points: readonly MapPoint[]; onOpen?: (point: MapPoint) => void; onOpenAt?: (x: number, z: number) => void; className?: string }) {
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
  const { minX, maxX, minZ, maxZ } = WORLD_MAP_IMAGE_BOUNDS;
  const imageSpanX = maxX - minX, imageSpanZ = maxZ - minZ;
  const px = (x: number) => ((x - view.x0) / view.spanX) * 100;
  const pz = (z: number) => ((z - view.z0) / view.spanZ) * 100;
  const style = {
    aspectRatio: String(ASPECT),
    backgroundImage: `url(${gameUrl(IMAGE.path)})`,
    backgroundSize: `${(imageSpanX / view.spanX) * 100}% ${(imageSpanZ / view.spanZ) * 100}%`,
    // Percent positions align the same fraction of image and box, so the crop's offset is its share of the leftover image.
    backgroundPosition: `${((view.x0 - minX) / (imageSpanX - view.spanX)) * 100 || 0}% ${((view.z0 - minZ) / (imageSpanZ - view.spanZ)) * 100 || 0}%`,
  };
  const scale = Math.round(view.spanX);
  return <div className={`points-map ${className}`.trim()} style={style} role="img" aria-label={`Map of ${points.length} ${points.length === 1 ? "place" : "places"}`}
    onClick={event => { if (!onOpenAt || event.target !== event.currentTarget) return; const box = event.currentTarget.getBoundingClientRect(); onOpenAt(view.x0 + ((event.clientX - box.left) / box.width) * view.spanX, view.z0 + ((event.clientY - box.top) / box.height) * view.spanZ); }}>
    {points.map(point => <button type="button" key={point.id} className={`points-map-pin${point.selected ? " is-selected" : ""}`} style={{ left: `${px(point.x)}%`, top: `${pz(point.z)}%` }} title={point.label} aria-label={point.label} onClick={() => onOpen?.(point)}>
      {point.radius ? <span className="points-map-radius" style={{ width: `${(point.radius * 2 / view.spanX) * 100}cqw` }} /> : null}
      <span className="points-map-dot" />
      <span className="points-map-label">{point.label}</span>
    </button>)}
    {(view.x0 + view.spanX < minX || view.x0 > maxX || view.z0 + view.spanZ < minZ || view.z0 > maxZ) && <span className="points-map-note">Beyond the drawn map</span>}
    <span className="points-map-scale">{scale} m across</span>
  </div>;
}
