import { useEffect, useRef, useState } from "react";
import { cn } from "../../../lib/utils.js";
import { useAssetThumbnail } from "../../../ui/assetThumbnails.js";
import { creatureThumbnailKey } from "../../../viewer/thumbnailKeys.js";

/**
 * One creature definition as the game draws it (scale, tier tint, dye), from the shared thumbnail
 * cache. The picture is only asked for once the box scrolls near the viewport, so a contact sheet of
 * 177 bodies renders what is on screen first. With no picture the box stays an empty art tile.
 */
export function CreatureArt({ creatureId, className }: { creatureId: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setNear(true); }, { rootMargin: "200px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  const url = useAssetThumbnail(near ? creatureThumbnailKey(creatureId) : undefined);
  return <span ref={box} className={cn("grid place-items-center overflow-hidden bg-art", className)} data-creature-art={creatureId}>
    {url && <img src={url} alt="" loading="lazy" decoding="async" className="block size-full object-contain" />}
  </span>;
}
