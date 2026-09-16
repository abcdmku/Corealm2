import { useState, type CSSProperties } from "react";
import { ImageOff, MapPinOff, type LucideIcon } from "lucide-react";
import { itemIconUrl } from "../../../game/src/ui/itemIcons.js";
import { spellIconSvg, type SpellIconSubject } from "../../../game/src/ui/spellIcons.js";
import { WORLD_MAP_IMAGE_BOUNDS, WORLD_MAP_MINIMAP_RENDITION } from "../../../game/src/generated/worldMapFingerprint.js";
import { gameUrl } from "../model/gameUrl.js";
import type { ThumbSpec } from "../model/summaries.js";
import { useAssetThumbnail } from "./assetThumbnails.js";
import { cn } from "../lib/utils.js";

const SIZE: Readonly<Record<string, string>> = {
  s: "size-[22px]", m: "size-8", l: "size-12 rounded-md", xl: "size-[88px] rounded-md", fill: "size-full rounded-none border-0",
};

export type ThumbSize = "s" | "m" | "l" | "xl" | "fill";

export function itemIconSource(id: string, large = false): string | undefined {
  const url = itemIconUrl({ id } as NonNullable<Parameters<typeof itemIconUrl>[0]>);
  if (!url) return undefined;
  return large && !__DEVDOCS_PLAYER__ ? `/__devdocs/icons/${url.split("/").at(-1)}` : gameUrl(url);
}

function ItemImage({ id, alt, large }: { id: string; alt: string; large: boolean }) {
  const [failed, setFailed] = useState(false);
  const source = itemIconSource(id, large);
  if (failed || !source) return <span className={GLYPH} title={`No icon for ${id}`}><ImageOff /></span>;
  return <img key={id} src={source} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

const GLYPH = "thumb-glyph grid size-full place-items-center bg-[color:var(--glyph-bg,transparent)] text-[color:var(--glyph-ink,var(--faint))] [&_svg]:size-[52%]";

function glyphStyle(hue: number | undefined): CSSProperties | undefined {
  if (hue === undefined) return undefined;
  return { "--glyph-bg": `hsl(${hue} 34% 28% / .55)`, "--glyph-ink": `hsl(${hue} 55% 78%)` } as CSSProperties;
}

function MapCrop({ x, z, span, children }: { x: number; z: number; span: number; children?: React.ReactNode }) {
  const { minX, maxX, minZ, maxZ } = WORLD_MAP_IMAGE_BOUNDS;
  const inside = x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  if (!inside) return <span className={GLYPH} title="Beyond the drawn map">{children ?? <MapPinOff />}</span>;
  // Scale the minimap so `span` metres fill the thumb, then offset so (x, z) sits at the centre.
  const scale = (maxX - minX) / span;
  const px = ((x - minX) / (maxX - minX)) * 100;
  const pz = ((z - minZ) / (maxZ - minZ)) * 100;
  return <span className="grid size-full place-items-center bg-art bg-no-repeat" style={{ backgroundImage: `url(${gameUrl(WORLD_MAP_MINIMAP_RENDITION.path)})`, backgroundSize: `${scale * 100}%`, backgroundPosition: `${px}% ${pz}%` }}>
    {children && <span className="grid size-[45%] place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_0_0_2px_#0006] [&_svg]:size-[65%]">{children}</span>}
  </span>;
}

/** One thumbnail component for every record kind. Falls back to a coloured glyph when no art exists. */
export function Thumb({ spec, size = "m", alt = "", className }: { spec: ThumbSpec; size?: ThumbSize; alt?: string; className?: string }) {
  const large = size === "xl" || size === "fill";
  return <span className={cn(
    "thumb relative inline-grid shrink-0 place-items-center overflow-hidden rounded-sm border border-border-subtle bg-art text-faint [&_img]:block [&_img]:size-full [&_img]:object-contain",
    SIZE[size], className,
  )} data-size={size} data-kind={spec.kind}>
    <ThumbContent spec={spec} large={large} alt={alt} />
  </span>;
}

function ThumbContent({ spec, large, alt }: { spec: ThumbSpec; large: boolean; alt: string }) {
  switch (spec.kind) {
    case "item": return <ItemImage id={spec.id} alt={alt} large={large} />;
    case "items": return <span className={cn("grid size-full gap-px p-0.5 [&_img]:min-h-0 [&_img]:min-w-0", spec.ids.length <= 1 ? "grid-cols-1 grid-rows-1" : spec.ids.length === 2 ? "grid-cols-2 grid-rows-1" : "grid-cols-2 grid-rows-2")} data-count={Math.min(4, spec.ids.length)}>{spec.ids.slice(0, 4).map((id, index) => <ItemImage key={`${id}:${index}`} id={id} alt="" large={false} />)}</span>;
    case "map": { const Icon = spec.icon; return <MapCrop x={spec.x} z={spec.z} span={spec.span}>{Icon ? <Icon /> : undefined}</MapCrop>; }
    case "asset": return <AssetThumb assetId={spec.assetId} icon={spec.icon} hue={spec.hue} alt={alt} />;
    case "spell": return <span className="block size-full [&_svg]:block [&_svg]:size-full" title={alt || undefined} dangerouslySetInnerHTML={{ __html: spellIconSvg(spec as unknown as SpellIconSubject) }} />;
    case "glyph": { const Icon = spec.icon; return <span className={GLYPH} style={glyphStyle(spec.hue)}>{spec.letter ? <span className="font-mono text-[max(10.5px,40%)] font-semibold tracking-tight">{spec.letter}</span> : <Icon />}</span>; }
  }
}

function AssetThumb({ assetId, icon: Icon, hue, alt }: { assetId: string; icon: LucideIcon; hue?: number; alt: string }) {
  const url = useAssetThumbnail(assetId);
  if (url) return <img src={url} alt={alt} loading="lazy" decoding="async" />;
  return <span className={GLYPH} style={glyphStyle(hue)} title={assetId}><Icon /></span>;
}
