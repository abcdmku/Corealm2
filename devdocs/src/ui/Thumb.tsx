import { useState, type CSSProperties } from "react";
import { ImageOff, MapPinOff, type LucideIcon } from "lucide-react";
import { itemIconArtworkId } from "../../../game/src/ui/itemIcons.js";
import { itemIconPublicPaths } from "../../../game/src/content/itemIconArt.js";
import { spellIconSvg, type SpellIconSubject } from "../../../game/src/ui/spellIcons.js";
import { WORLD_MAP_MINIMAP_RENDITION } from "../../../game/src/generated/worldMapFingerprint.js";
import { can } from "../api/backend.js";
import { gameFileUrl, serverFileSha } from "../model/serverFiles.js";
import { useServerWorldMap, worldMapFileUrl } from "../model/serverWorldMap.js";
import { IMAGE_BOX, cropPosition, onDrawnMap } from "../model/worldMap.js";
import type { ThumbSpec } from "../model/summaries.js";
import { useAssetThumbnail } from "./assetThumbnails.js";
import { cn } from "../lib/utils.js";

const SIZE: Readonly<Record<string, string>> = {
  s: "size-[22px]", m: "size-8", l: "size-12 rounded-md", xl: "size-[88px] rounded-md", fill: "size-full rounded-none border-0",
};

export type ThumbSize = "s" | "m" | "l" | "xl" | "fill";

export function itemIconSource(id: string, large = false): string | undefined {
  return itemIconSources(id, large)[0];
}

/**
 * Where an item's icon loads from, best first. Large: the 256 master (the checkout's source file in
 * repo mode, the server's stored one on a live server). Then the 48 icon, from the server's own files
 * when it replaced it, else the asset host. A base item on a live server has no master there (the
 * asset host ships only the 48), so its large view is the 48 upscaled (`upscaledIcon`).
 */
export function itemIconSources(id: string, large = false): string[] {
  const artworkId = itemIconArtworkId(id), paths = itemIconPublicPaths(artworkId);
  const game = gameFileUrl(paths.game);
  if (!large) return [game];
  if (can("assets")) return [`/__devdocs/icons/${encodeURIComponent(artworkId)}.png`, game];
  return serverFileSha(paths.master) ? [gameFileUrl(paths.master), game] : [game];
}

/** A 48 icon drawn larger keeps its pixels crisp instead of blurring them. */
export const upscaledIcon = (source: string | undefined): boolean => Boolean(source?.includes("/items/48/"));

function ItemImage({ id, alt, large }: { id: string; alt: string; large: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const sources = itemIconSources(id, large);
  const source = sources[attempt];
  if (!source) return <span className={GLYPH} title={`No icon for ${id}`}><ImageOff /></span>;
  return <img key={`${id}:${attempt}`} src={source} alt={alt} loading="lazy" decoding="async"
    style={large && upscaledIcon(source) ? { imageRendering: "pixelated" } : undefined} data-upscaled={large && upscaledIcon(source) ? "" : undefined}
    onError={() => setAttempt(attempt + 1)} />;
}

const GLYPH = "thumb-glyph grid size-full place-items-center bg-[color:var(--glyph-bg,transparent)] text-[color:var(--glyph-ink,var(--faint))] [&_svg]:size-[52%]";

function glyphStyle(hue: number | undefined, colour?: string): CSSProperties | undefined {
  if (colour) return { "--glyph-bg": `color-mix(in oklab, ${colour} 38%, transparent)`, "--glyph-ink": `color-mix(in oklab, ${colour} 55%, white)` } as CSSProperties;
  if (hue === undefined) return undefined;
  return { "--glyph-bg": `hsl(${hue} 34% 28% / .55)`, "--glyph-ink": `hsl(${hue} 55% 78%)` } as CSSProperties;
}

function MapCrop({ x, z, span, children }: { x: number; z: number; span: number; children?: React.ReactNode }) {
  const serverMap = useServerWorldMap();
  if (!onDrawnMap(x, z)) return <span className={GLYPH} title="Beyond the drawn map">{children ?? <MapPinOff />}</span>;
  // Scale the minimap so `span` metres fill the thumb, then offset so (x, z) sits at the centre.
  const scale = IMAGE_BOX.spanX / span;
  const { u, v } = cropPosition({ x0: x - span / 2, z0: z - span / 2, spanX: span, spanZ: span });
  return <span className="grid size-full -scale-x-100 place-items-center bg-art bg-no-repeat" style={{ backgroundImage: `url(${worldMapFileUrl(WORLD_MAP_MINIMAP_RENDITION.path, serverMap)})`, backgroundSize: `${scale * 100}%`, backgroundPosition: `${u * 100}% ${v * 100}%` }}>
    {children && <span className="grid size-[45%] -scale-x-100 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_0_0_2px_#0006] [&_svg]:size-[65%]">{children}</span>}
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
    case "glyph": { const Icon = spec.icon; return <span className={GLYPH} style={glyphStyle(spec.hue, spec.colour)}>{spec.letter ? <span className="font-mono text-[max(10.5px,40%)] font-semibold tracking-tight">{spec.letter}</span> : <Icon />}</span>; }
  }
}

function AssetThumb({ assetId, icon: Icon, hue, alt }: { assetId: string; icon: LucideIcon; hue?: number; alt: string }) {
  const url = useAssetThumbnail(assetId);
  if (url) return <img src={url} alt={alt} loading="lazy" decoding="async" />;
  return <span className={GLYPH} style={glyphStyle(hue)} title={assetId}><Icon /></span>;
}
