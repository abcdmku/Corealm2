import * as THREE from 'three';

let variants: Record<string, string> = {};
let base = '';
const priorityTextures = new Set<string>();
/** Touch devices keep a smaller texture and viewing-distance budget. */
export function usesMobileAssets(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
export function configureAssetDelivery(root: string, textures: Record<string, string> = {},
  desktopTextures: Record<string, string> = {}): void {
  if (typeof document === 'undefined') return;
  base = new URL(root, document.baseURI).href;
  variants = usesMobileAssets() ? textures : desktopTextures;
  priorityTextures.clear();
  THREE.DefaultLoadingManager.setURLModifier(deliveryUrl);
}
export function deliveryUrl(url: string): string {
  if (!base || /^(?:data|blob):/.test(url)) return url;
  const absolute = new URL(url, document.baseURI).href;
  const key = absolute.startsWith(base) ? absolute.slice(base.length) : '';
  const target = variants[key] ? new URL(variants[key], base).href : url;
  // These shared maps gate world construction. ImageLoader creates offscreen images, so
  // Chrome can leave them behind model fetches even though the loading screen needs them.
  // Hint only maps actually requested, and use ImageLoader's CORS mode to share its request.
  if (variants[key] && /^textures\/(corealm|castle-stone|fairy-ground|fairy-rock)\//.test(key)
    && !priorityTextures.has(target)) {
    priorityTextures.add(target);
    const hint = document.createElement('link');
    hint.rel = 'preload'; hint.as = 'image'; hint.fetchPriority = 'high';
    hint.crossOrigin = 'anonymous'; hint.href = target;
    hint.onload = hint.onerror = () => hint.remove();
    document.head.append(hint);
  }
  return target;
}
