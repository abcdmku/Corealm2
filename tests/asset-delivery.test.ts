import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { configureAssetDelivery, deliveryUrl } from '../game/src/render/assetDelivery.js';
import { drawDistanceMetres } from '../game/src/render/renderer.js';

afterEach(() => {
  configureAssetDelivery('/assets/');
  vi.unstubAllGlobals();
});

it.each([false, true])('routes authored textures for coarse pointer %s without changing other URLs or distance presets', coarse => {
  vi.stubGlobal('document', { baseURI: 'https://game.example/play/' });
  vi.stubGlobal('matchMedia', () => ({ matches: coarse }));
  configureAssetDelivery('/assets/', { 'paint.png': 'compact/paint.webp' }, { 'paint.png': 'optimized/paint.webp' });
  const expected = `https://game.example/assets/${coarse ? 'compact' : 'optimized'}/paint.webp`;
  expect(deliveryUrl('/assets/paint.png')).toBe(expected);
  expect(THREE.DefaultLoadingManager.resolveURL('/assets/paint.png')).toBe(expected);
  for (const url of ['data:image/png;base64,AA==', 'blob:paint', '/assets/other.png', 'https://other.example/assets/paint.png']) {
    expect(deliveryUrl(url)).toBe(url);
  }
  expect(drawDistanceMetres('near')).toBe(coarse ? 65 : 130);
  expect(drawDistanceMetres('medium')).toBe(210);
  // A dev manifest must clear the release map, including when the input device changes.
  configureAssetDelivery('/assets/');
  expect(deliveryUrl('/assets/paint.png')).toBe('/assets/paint.png');
});

it('prioritizes requested shared terrain maps once, with the same CORS mode as ImageLoader', () => {
  const hints: any[] = [];
  vi.stubGlobal('document', {baseURI:'https://game.example/', head:{append:(hint:any)=>hints.push(hint)},
    createElement:()=>({remove:vi.fn()})});
  vi.stubGlobal('matchMedia', () => ({matches:false}));
  configureAssetDelivery('/assets/', {}, {'textures/fairy-rock/stone.png':'optimized/stone.webp',
    'shared-textures/skin.png':'optimized/skin.webp'});
  expect(hints).toHaveLength(0);
  const url = deliveryUrl('/assets/textures/fairy-rock/stone.png');
  deliveryUrl('/assets/textures/fairy-rock/stone.png');
  deliveryUrl('/assets/shared-textures/skin.png');
  expect(hints).toHaveLength(1);
  expect(hints[0]).toMatchObject({href:url,rel:'preload',as:'image',fetchPriority:'high',crossOrigin:'anonymous'});
  hints[0].onload();
  expect(hints[0].remove).toHaveBeenCalledOnce();
});
