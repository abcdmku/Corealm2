import { useState, type CSSProperties } from "react";
import { ImageOff, type LucideIcon } from "lucide-react";
import { itemIconUrl } from "../../../game/src/ui/itemIcons.js";
import { WORLD_MAP_IMAGE_BOUNDS, WORLD_MAP_MINIMAP_RENDITION } from "../../../game/src/generated/worldMapFingerprint.js";
import { gameUrl } from "../model/gameUrl.js";
import type { ThumbSpec } from "../model/summaries.js";
import { useAssetThumbnail } from "./assetThumbnails.js";

export type ThumbSize = "s" | "m" | "l" | "xl" | "fill";

export function itemIconSource(id: string, large = false): string | undefined {
  const url = itemIconUrl({ id } as NonNullable<Parameters<typeof itemIconUrl>[0]>);
  if (!url) return undefined;
  return large && !__DEVDOCS_PLAYER__ ? `/__devdocs/icons/${url.split("/").at(-1)}` : gameUrl(url);
}

function ItemImage({ id, alt, large }: { id: string; alt: string; large: boolean }) {
  const [failed, setFailed] = useState(false);
  const source = itemIconSource(id, large);
  if (failed || !source) return <span className="thumb-glyph" title={`No icon for ${id}`}><ImageOff /></span>;
  return <img key={id} src={source} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function glyphStyle(hue: number | undefined): CSSProperties | undefined {
  if (hue === undefined) return undefined;
  return { "--glyph-bg": `hsl(${hue} 34% 28% / .55)`, "--glyph-ink": `hsl(${hue} 55% 78%)` } as CSSProperties;
}

function MapCrop({ x, z, span, children }: { x: number; z: number; span: number; children?: React.ReactNode }) {
  const { minX, maxX, minZ, maxZ } = WORLD_MAP_IMAGE_BOUNDS;
  const inside = x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  if (!inside) return <span className="thumb-glyph">{children}</span>;
  // Scale the minimap so `span` metres fill the thumb, then offset so (x, z) sits at the centre.
  const scale = (maxX - minX) / span;
  const px = ((x - minX) / (maxX - minX)) * 100;
  const pz = ((z - minZ) / (maxZ - minZ)) * 100;
  return <span className="thumb-map" style={{ backgroundImage: `url(${gameUrl(WORLD_MAP_MINIMAP_RENDITION.path)})`, backgroundSize: `${scale * 100}%`, backgroundPosition: `${px}% ${pz}%` }}>
    {children && <span className="thumb-map-pin">{children}</span>}
  </span>;
}

/** One thumbnail component for every record kind. Falls back to a coloured glyph when no art exists. */
export function Thumb({ spec, size = "m", alt = "", className = "" }: { spec: ThumbSpec; size?: ThumbSize; alt?: string; className?: string }) {
  const large = size === "xl" || size === "fill";
  return <span className={`thumb ${className}`.trim()} data-size={size} data-kind={spec.kind}>
    <ThumbContent spec={spec} large={large} alt={alt} />
  </span>;
}

function ThumbContent({ spec, large, alt }: { spec: ThumbSpec; large: boolean; alt: string }) {
  switch (spec.kind) {
    case "item": return <ItemImage id={spec.id} alt={alt} large={large} />;
    case "items": return <span className="thumb-composite" data-count={Math.min(4, spec.ids.length)}>{spec.ids.slice(0, 4).map((id, index) => <ItemImage key={`${id}:${index}`} id={id} alt="" large={false} />)}</span>;
    case "map": { const Icon = spec.icon; return <MapCrop x={spec.x} z={spec.z} span={spec.span}>{Icon ? <Icon /> : undefined}</MapCrop>; }
    case "asset": return <AssetThumb assetId={spec.assetId} icon={spec.icon} hue={spec.hue} alt={alt} />;
    case "glyph": { const Icon = spec.icon; return <span className="thumb-glyph" style={glyphStyle(spec.hue)}>{spec.letter ? <span className="thumb-letter">{spec.letter}</span> : <Icon />}</span>; }
  }
}

function AssetThumb({ assetId, icon: Icon, hue, alt }: { assetId: string; icon: LucideIcon; hue?: number; alt: string }) {
  const url = useAssetThumbnail(assetId);
  if (url) return <img src={url} alt={alt} loading="lazy" decoding="async" />;
  return <span className="thumb-glyph" style={glyphStyle(hue)} title={assetId}><Icon /></span>;
}
