import { useEffect, useState } from "react";

/**
 * Rendered thumbnails for GLB assets. The manifest ships no 2D previews for creatures, NPCs or
 * props, so previews are produced on demand by a renderer registered at runtime and cached by the
 * dev server. Until a renderer is installed, callers fall back to glyphs.
 */
export type ThumbnailProvider = (assetId: string) => Promise<string | undefined>;

let provider: ThumbnailProvider | undefined;
const cache = new Map<string, string | undefined>();
const pending = new Map<string, Promise<string | undefined>>();
const listeners = new Set<() => void>();

export function installThumbnailProvider(next: ThumbnailProvider | undefined): void {
  provider = next;
  cache.clear();
  pending.clear();
  listeners.forEach(listener => listener());
}

export function thumbnailProviderInstalled(): boolean { return provider !== undefined; }

export function requestAssetThumbnail(assetId: string): Promise<string | undefined> {
  if (!provider) return Promise.resolve(undefined);
  if (cache.has(assetId)) return Promise.resolve(cache.get(assetId));
  let inFlight = pending.get(assetId);
  if (!inFlight) {
    inFlight = provider(assetId).catch(() => undefined).then(url => {
      cache.set(assetId, url);
      pending.delete(assetId);
      listeners.forEach(listener => listener());
      return url;
    });
    pending.set(assetId, inFlight);
  }
  return inFlight;
}

export function useAssetThumbnail(assetId: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => assetId ? cache.get(assetId) : undefined);
  useEffect(() => {
    if (!assetId) return;
    let active = true;
    const refresh = () => {
      if (!active) return;
      if (cache.has(assetId)) setUrl(cache.get(assetId));
      else void requestAssetThumbnail(assetId).then(next => { if (active) setUrl(next); });
    };
    listeners.add(refresh);
    refresh();
    return () => { active = false; listeners.delete(refresh); };
  }, [assetId]);
  return url;
}
