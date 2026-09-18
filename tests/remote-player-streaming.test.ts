import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { EntityViews } from "../game/src/render/entityViews.js";
import { MaterialLibrary } from "../game/src/render/materials.js";
import { AnimationLod } from "../game/src/render/animationLod.js";
import { StreamedShaderWarmup } from "../game/src/render/streamedShaderWarmup.js";

function source(name: string): THREE.Group {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) weights[index * 4] = 1;
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ name }));
  const bone = new THREE.Bone();
  bone.name = "Spine";
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  root.add(mesh);
  root.updateMatrixWorld(true);
  return root;
}

async function fixture(options: { partialWarmup?: boolean } = {}) {
  const originals = new Map([['test_creature', source(options.partialWarmup ? 'MI_Regular_Male' : 'first')], ['next_creature', source('second')]]);
  if (options.partialWarmup) {
    const root = originals.get('test_creature')!;
    const body = root.children[0] as THREE.SkinnedMesh;
    const outfit = new THREE.SkinnedMesh(body.geometry.clone(), new THREE.MeshStandardMaterial({ name: 'MI_Peasant' }));
    outfit.bind(body.skeleton, body.bindMatrix);
    root.add(outfit);
  }
  const loaded = new Set<string>();
  let resolveNext!: (root: THREE.Group) => void;
  const next = new Promise<THREE.Group>(resolve => { resolveNext = resolve; });
  const clips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].map(name =>
    new THREE.AnimationClip(name, 1, [new THREE.VectorKeyframeTrack('Spine.position', [0, .5, 1], [0, 0, 0, 0, .2, 0, 0, 0, 0])]));
  const assets = {
    entry: (id: string) => ({ id, animations: clips.map(clip => clip.name), size: { x: 1, y: 1, z: 1 } }),
    isLoaded: (id: string) => loaded.has(id),
    load: async (id: string) => {
      const root = id === 'next_creature' ? await next : originals.get(id)!;
      loaded.add(id);
      return root;
    },
    instance: (id: string) => originals.get(id),
    clipOf: (_id: string, name: string) => clips.find(clip => clip.name === name),
    clip: () => undefined,
  };
  const scene = { entityGroup: new THREE.Group(), overlayGroup: new THREE.Group() };
  const ready = new WeakSet<THREE.Object3D>();
  let gated = options.partialWarmup === true;
  const materials = new MaterialLibrary();
  const views = new EntityViews(scene, assets as never, materials, {
    maxUniqueViews: 1, maxUniqueDrawCalls: 100, maxAnimatedViews: 1,
    isViewReady: root => !gated || ready.has(root),
  });
  const actor: SemanticEntity = {
    id: 'remote:arriving-player', name: 'Player', archetype: 'enemy', tier: 1,
    regionId: 'fallowmarch', position: [0, 0, 0], state: 'alive', interactions: ['inspect'],
    view: { assetId: 'test_creature' },
  };
  await views.prepare([actor]);
  views.sync([actor]);
  views.update(.016, new THREE.Vector3());
  return {
    actor, views, scene,
    gate() { scene.entityGroup.traverse(node => ready.add(node)); gated = true; },
    prepareShaders() { scene.entityGroup.traverse(node => ready.add(node)); },
    prepareBatches(count: number) {
      scene.entityGroup.traverse(node => {
        if ((node as THREE.BatchedMesh).isBatchedMesh && count-- > 0) ready.add(node);
      });
    },
    async finishDownload() {
      resolveNext(originals.get('next_creature')!);
      for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    },
    dispose() {
      views.dispose(); materials.dispose();
      for (const root of originals.values()) root.traverse(node => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
      });
    },
  };
}

describe('remote player streaming continuity', () => {
  it('reveals a newly joined player only when the whole fallback outfit is prepared', async () => {
    const f = await fixture({ partialWarmup: true });
    try {
      expect(f.views.presentationSnapshot(f.actor.id)).toMatchObject({ renderedMeshes: 0, expectedMeshes: 2, complete: false });
      const batches = [...((f.views as any).batches as Map<string, any>).values()];
      expect(batches).toHaveLength(2);
      // No real slot has been drawn. Tint-capable batches already have their final shader layout.
      for (const batch of batches) {
        expect(batch.mesh._colorsTexture).not.toBeNull();
        expect(batch.usedInstances).toBe(0);
        expect(batch.owners).toHaveLength(0);
      }
      const colors = batches.map(batch => batch.mesh._colorsTexture);
      f.prepareBatches(1);
      f.views.update(.016, new THREE.Vector3());
      expect(f.views.presentationSnapshot(f.actor.id)).toMatchObject({ renderedMeshes: 0, expectedMeshes: 2, complete: false });
      f.prepareBatches(2);
      f.views.update(.016, new THREE.Vector3());
      expect(f.views.presentationSnapshot(f.actor.id)).toMatchObject({ renderedMeshes: 2, expectedMeshes: 2, complete: true });
      expect(batches.map(batch => batch.mesh._colorsTexture)).toEqual(colors);
      f.prepareShaders();
      f.views.update(.016, new THREE.Vector3());
      expect(f.views.presentationSnapshot(f.actor.id)).toMatchObject({ mode: 'live-rig', renderedMeshes: 2, complete: true });
    } finally { f.dispose(); }
  });

  it('continues an attack at the same phase and rate after an appearance handoff', async () => {
    const f = await fixture();
    try {
      f.views.setLocomotion(f.actor.id, 'idle');
      expect(f.views.playAction(f.actor.id, 'attack', { durationSeconds: 2 })).toBe(true);
      f.views.update(.2, new THREE.Vector3());
      const before = f.views.motionSnapshot(f.actor.id)!;
      f.actor.view!.assetId = 'next_creature';
      f.views.sync([f.actor]);
      await f.finishDownload();
      f.views.sync([f.actor]);
      const after = f.views.motionSnapshot(f.actor.id)!;
      expect(after.motion).toBe('attack');
      expect(after.time).toBe(before.time);
      expect(after.timeScale).toBe(before.timeScale);
      f.views.setLocomotion(f.actor.id, 'idle');
      f.views.update(.2, new THREE.Vector3());
      expect(f.views.motionSnapshot(f.actor.id)?.motion).toBe('attack');
      expect(f.views.motionSnapshot(f.actor.id)!.time).toBeGreaterThan(after.time!);
    } finally { f.dispose(); }
  });

  it('keeps prepared sampled actors visible when the seventeenth and thirty-third actors join', () => {
    const root = source('crowd');
    const clip = new THREE.AnimationClip('Idle', 1, [new THREE.VectorKeyframeTrack('Spine.position', [0, 1], [0, 0, 0, 0, .1, 0])]);
    const scene = new THREE.Scene();
    const lod = new AnimationLod(scene, root, root, [clip], material => material);
    for (let slot = 0; slot < 16; slot++) lod.set(slot, new THREE.Matrix4().makeTranslation(slot, 0, 0), { clip, time: .25, blend: 1 });
    const initialMeshes = [...scene.children];
    const warmup = new StreamedShaderWarmup({} as THREE.WebGLRenderer, scene, new THREE.PerspectiveCamera());
    try {
      for (let slot = 16; slot < 33; slot++) {
        expect(lod.isViewReady(mesh => !warmup.hasPending(mesh))).toBe(true);
        lod.set(slot, new THREE.Matrix4().makeTranslation(slot, 0, 0), { clip, time: .25, blend: 1 });
        expect(scene.children).toEqual(initialMeshes);
        expect(warmup.getState()).toMatchObject({ waiting: 0, queued: 0 });
        for (let resident = 0; resident <= slot; resident++) {
          expect(lod.renderedMeshCount(resident, mesh => !warmup.hasPending(mesh))).toBe(1);
        }
      }
      const mesh = scene.children[0] as THREE.InstancedMesh;
      expect(mesh.instanceMatrix.count).toBe(64);
      expect(mesh.count).toBe(33);
      const position = new THREE.Matrix4();
      for (let slot = 0; slot < 33; slot++) {
        mesh.getMatrixAt(slot, position);
        expect(position.elements[12]).toBe(slot);
      }
    } finally {
      warmup.dispose(); lod.dispose();
      root.traverse(node => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
      });
    }
  });

  it('keeps the current moving player drawn through asset download and replacement shader preparation', async () => {
    const f = await fixture();
    try {
      const records = (f.views as any).records as Map<string, any>;
      const original = records.get(f.actor.id);
      expect(f.views.presentationSnapshot(f.actor.id)?.renderedMeshes).toBeGreaterThan(0);
      f.gate();
      f.actor.view!.assetId = 'next_creature';
      f.views.sync([f.actor]);
      expect(records.get(f.actor.id)).toBe(original);
      f.actor.position = [2, 0, 0];
      f.views.syncResidentMotion();
      f.views.update(.016, new THREE.Vector3());
      expect(f.views.positionOf(f.actor.id)?.x).toBe(2);
      expect(f.views.presentationSnapshot(f.actor.id)?.renderedMeshes).toBeGreaterThan(0);

      await f.finishDownload();
      const jobs: Array<() => void> = [];
      (f.views as any).schedulePreparation = (work: () => void) => new Promise<void>(resolve => jobs.push(() => { work(); resolve(); }));
      f.views.sync([f.actor]);
      expect(jobs).toHaveLength(1);
      expect(records.get(f.actor.id)).toBe(original);
      jobs.shift()!();
      await Promise.resolve();
      f.views.sync([f.actor]);
      expect(records.get(f.actor.id)).toBe(original);
      expect(f.views.presentationSnapshot(f.actor.id)).toMatchObject({ pendingReplacement: true });
      expect(f.views.presentationSnapshot(f.actor.id)?.renderedMeshes).toBeGreaterThan(0);

      f.prepareShaders();
      f.views.sync([f.actor]);
      expect(records.get(f.actor.id)).not.toBe(original);
      expect(f.views.presentationSnapshot(f.actor.id)).toMatchObject({ pendingReplacement: false });
      // The new live rig is still preparing. Its prepared fallback must draw in the same frame.
      expect(f.views.presentationSnapshot(f.actor.id)?.renderedMeshes).toBeGreaterThan(0);
    } finally { f.dispose(); }
  });

  it('retains a live rig until the sampled replacement shaders are ready', async () => {
    const f = await fixture();
    try {
      const record = (f.views as any).records.get(f.actor.id);
      const original = record.unique;
      f.gate();
      f.views.update(.016, new THREE.Vector3(100, 0, 0));
      const group = (f.views as any).groups.get(record.groupKey);
      expect(group.animationLod.ready).toBe(true);
      expect(record.unique).toBe(original);
      expect(f.views.presentationSnapshot(f.actor.id)?.renderedMeshes).toBeGreaterThan(0);
      f.prepareShaders();
      f.views.update(.016, new THREE.Vector3(100, 0, 0));
      expect(record.unique).toBeNull();
      expect(f.views.presentationSnapshot(f.actor.id)?.mode).toBe('sampled-rig');
      expect(f.views.presentationSnapshot(f.actor.id)?.renderedMeshes).toBeGreaterThan(0);
    } finally { f.dispose(); }
  });

  it('cancels a queued appearance when the player returns to the already drawn one', async () => {
    const f = await fixture();
    try {
      const original = (f.views as any).records.get(f.actor.id);
      f.actor.view!.assetId = 'next_creature';
      f.views.sync([f.actor]);
      await f.finishDownload();
      const jobs: Array<() => void> = [];
      (f.views as any).schedulePreparation = (work: () => void) => new Promise<void>(resolve => jobs.push(() => { work(); resolve(); }));
      f.views.sync([f.actor]);
      f.actor.view!.assetId = 'test_creature';
      f.views.sync([f.actor]);
      jobs.shift()!();
      await Promise.resolve();
      expect((f.views as any).records.get(f.actor.id)).toBe(original);
      expect(f.views.presentationSnapshot(f.actor.id)).toMatchObject({ pendingReplacement: false });
      expect([...((f.views as any).groups as Map<string, unknown>).keys()].some(key => key.startsWith('next_creature|'))).toBe(false);
    } finally { f.dispose(); }
  });
});
