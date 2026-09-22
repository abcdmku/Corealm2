import * as THREE from "three";
import { afterEach, expect, it, vi } from "vitest";
import { ElementalParticleCloud } from "../game/src/render/elementalParticleCloud.js";
import { ElementalFilaments } from "../game/src/render/elementalFilaments.js";
import { ElementalEnergyBodies } from "../game/src/render/elementalEnergyBodies.js";
import { ElementalFluidBodies } from "../game/src/render/elementalFluidBodies.js";
import { ElementalFlowSurfaces } from "../game/src/render/elementalFlowSurfaces.js";
import { ElementalVolumes, ElementalSolids } from "../game/src/render/elementalVolumes.js";
import { lowerToWgsl } from "./helpers/wgsl.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function textureFixture(kind: 'flow' | 'flame') {
  vi.resetModules();
  if (kind === 'flow') {
    const module = await import('../game/src/render/elementalFlowTexture.js');
    return { get: module.elementalFlowTexture, prepare: module.prepareElementalFlowTexture,
      wrapping: THREE.MirroredRepeatWrapping, value: 110, file: '/vfx/elemental-flow-v2.png' };
  }
  const module = await import('../game/src/render/elementalFlameTexture.js');
  return { get: module.elementalFlameTexture, prepare: module.prepareElementalFlameTexture,
    wrapping: THREE.RepeatWrapping, value: 128, file: '/vfx/elemental-flame-flow-v1.png' };
}

it.each(['flow', 'flame'] as const)('defers the %s image until explicit preparation and publishes only after decode', async kind => {
  vi.stubGlobal('document', {});
  let downloaded!: (image: HTMLImageElement) => void, decoded!: () => void;
  const load = vi.spyOn(THREE.ImageLoader.prototype, 'loadAsync').mockImplementation(() =>
    new Promise<HTMLImageElement>(resolve => { downloaded = resolve; }));
  const decode = vi.fn(() => new Promise<void>(resolve => { decoded = resolve; }));
  const image = { decode, naturalWidth: 16, naturalHeight: 16 } as unknown as HTMLImageElement;
  const fixture = await textureFixture(kind), texture = fixture.get();
  expect(fixture.get()).toBe(texture); expect(load).not.toHaveBeenCalled();
  expect(texture.image).toBeNull(); expect(texture.version).toBe(0);
  expect(texture.wrapS).toBe(fixture.wrapping); expect(texture.wrapT).toBe(fixture.wrapping);
  expect(texture.colorSpace).toBe(THREE.NoColorSpace);
  expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter); expect(texture.magFilter).toBe(THREE.LinearFilter);
  expect(texture.anisotropy).toBe(4);
  const ready = fixture.prepare();
  expect(fixture.prepare()).toBe(ready);
  expect(load).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(fixture.file));
  downloaded(image); await Promise.resolve();
  expect(decode).toHaveBeenCalledOnce(); expect(texture.image).toBeNull();
  decoded(); await ready;
  expect(fixture.get()).toBe(texture); expect(texture.image).toBe(image); expect(texture.version).toBe(1);
  expect(fixture.prepare()).toBe(ready); expect(load).toHaveBeenCalledOnce();
});

it.each(['download', 'decode'] as const)('rejects %s failure without publishing an incomplete elemental texture and allows retry', async phase => {
  vi.stubGlobal('document', {});
  const cause = new Error(`${phase} failed`);
  const image = { decode: vi.fn(phase === 'decode' ? async () => { throw cause; } : async () => {}) } as unknown as HTMLImageElement;
  const load = vi.spyOn(THREE.ImageLoader.prototype, 'loadAsync');
  if (phase === 'download') load.mockRejectedValueOnce(cause);
  else load.mockResolvedValueOnce(image);
  const fixture = await textureFixture('flow'), texture = fixture.get();
  await expect(fixture.prepare()).rejects.toThrow(`${phase} failed`);
  expect(texture.image).toBeNull(); expect(texture.version).toBe(0);
  const decoded = { decode: vi.fn(async () => {}) } as unknown as HTMLImageElement;
  load.mockResolvedValueOnce(decoded);
  await fixture.prepare();
  expect(fixture.get()).toBe(texture); expect(texture.image).toBe(decoded);
  expect(load).toHaveBeenCalledTimes(2);
});

it.each(['flow', 'flame'] as const)('retains the non-browser %s texture without fetching', async kind => {
  vi.stubGlobal('document', undefined);
  const load = vi.spyOn(THREE.ImageLoader.prototype, 'loadAsync');
  const fixture = await textureFixture(kind), texture = fixture.get() as THREE.DataTexture;
  await fixture.prepare();
  expect(texture.isDataTexture).toBe(true);
  expect([...texture.image.data!]).toEqual([fixture.value, fixture.value, fixture.value, 255]);
  expect(fixture.get()).toBe(texture); expect(load).not.toHaveBeenCalled();
});

it("lowers every elemental material variant with live instance geometry",()=>{
  const group=new THREE.Group();
  const effects=[...(["light","smoke","fragment","droplet"] as const).map(kind=>new ElementalParticleCloud(group,kind,4)),
    new ElementalFilaments(group),new ElementalFluidBodies(group),new ElementalFlowSurfaces(group),new ElementalVolumes(group),new ElementalSolids(group),
    ...(["earth","wind","water","fire"] as const).flatMap(element=>[new ElementalEnergyBodies(group,element),new ElementalEnergyBodies(group,element,true)])];
  try {
    let count=0;
    group.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      try {
        const shader=lowerToWgsl(object);
        expect(shader.vertex.length).toBeGreaterThan(200);
        expect(shader.fragment.length).toBeGreaterThan(200);
        expect((object.material as THREE.Material & {isNodeMaterial?:boolean}).isNodeMaterial).toBe(true);
        count++;
      } catch(error) {throw new Error(`${object.name}: ${String(error)}`,{cause:error});}
    });
    expect(count).toBe(27);
  } finally {for(const effect of effects)effect.dispose();}
});
