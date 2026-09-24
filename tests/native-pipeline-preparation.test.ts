import type { WebGPURenderer } from 'three/webgpu';
import { expect, it } from 'vitest';
import { withPipelineConcurrency } from '../game/src/render/nativePipelinePreparation.js';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(count = 4) {
  type Object = { id: number; getNodeBuilderState(): { updateAfterNodes: unknown[] } };
  const submitted: ReturnType<typeof deferred<unknown>>[] = [];
  const scopes: number[] = [], popped: number[] = [], results: { id: number; scope: unknown }[] = [];
  const built: number[] = [], after: number[] = [];
  let active = 0, peak = 0;
  const device = {
    pushErrorScope(_filter: string) { scopes.push(submitted.length); },
    popErrorScope() { const scope = scopes.pop(); popped.push(scope!); return Promise.resolve(scope); },
    createRenderPipelineAsync(_descriptor: unknown) {
      expect(this).toBe(device);
      const job = deferred<unknown>(); submitted.push(job);
      active++; peak = Math.max(peak, active);
      return job.promise.finally(() => { active--; });
    },
    createPipelineLayout() { expect(this).toBe(device); },
  };
  const backend = {
    isWebGPUBackend: true, device,
    createRenderPipeline(object: Object, promises: Promise<unknown>[] | null) {
      const captured = this.device;
      captured.createPipelineLayout();
      captured.pushErrorScope('validation');
      const promise = (async () => {
        await captured.createRenderPipelineAsync({});
        results.push({ id: object.id, scope: await captured.popErrorScope() });
      })();
      promises!.push(promise);
    },
  };
  const pipelines = {
    getForRender(object: Object, promises: Promise<unknown>[] | null = null) {
      if (promises) backend.createRenderPipeline(object, promises);
      return object;
    },
  };
  const renderer = { _initialized: true, backend, _pipelines: pipelines } as unknown as WebGPURenderer;
  const objects = Array.from({ length: count }, (_, id) => ({ id, getNodeBuilderState: () => ({ updateAfterNodes: [] as unknown[] }) }));
  const compile = async (selected = objects) => {
    for (const object of selected) {
      built.push(object.id);
      await Promise.resolve(); // Native node lowering remains in this serial loop.
      const promises: Promise<unknown>[] = [];
      pipelines.getForRender(object, promises);
      if (promises.length) await Promise.all(promises);
      after.push(object.id);
      await Promise.resolve();
    }
  };
  return { renderer, backend, pipelines, device, submitted, scopes, popped, results, built, after,
    objects, compile, peak: () => peak };
}

async function microtasks() { for (let index = 0; index < 20; index++) await Promise.resolve(); }

it('overlaps two pipelines, preserves serial node work, and restores hooks after every pipeline completes', async () => {
  const f = fixture(), originalGet = f.pipelines.getForRender, originalCreate = f.backend.createRenderPipeline;
  const preparing = withPipelineConcurrency(f.renderer, () => f.compile());
  let finished = false; void preparing.then(() => { finished = true; });
  await microtasks();
  expect(f.submitted).toHaveLength(2); expect(f.built).toEqual([0, 1]);
  expect(f.backend.device).toBe(f.device); expect(f.scopes).toEqual([]);
  expect(f.popped).toEqual([0, 1]);
  // Completion order differs from submission order without crossing validation scopes.
  f.submitted[1]!.resolve({}); await microtasks();
  expect(f.submitted).toHaveLength(3); expect(f.results).toEqual([{ id: 1, scope: 1 }]);
  f.submitted[2]!.resolve({}); await microtasks();
  expect(f.submitted).toHaveLength(4);
  f.submitted[3]!.resolve({}); await microtasks();
  expect(finished).toBe(false);
  f.submitted[0]!.resolve({}); await preparing;
  expect(f.peak()).toBe(2); expect(f.after).toEqual([0, 1, 2, 3]);
  expect(f.results.at(-1)).toEqual({ id: 0, scope: 0 });
  expect(f.pipelines.getForRender).toBe(originalGet);
  expect(f.backend.createRenderPipeline).toBe(originalCreate);
});

it('drains outstanding pipelines before a material updateAfter callback and before returning', async () => {
  const f = fixture();
  f.objects[1]!.getNodeBuilderState = () => ({ updateAfterNodes: [{}] });
  const preparing = withPipelineConcurrency(f.renderer, () => f.compile(f.objects.slice(0, 3)));
  await microtasks(); expect(f.after).toEqual([0]);
  f.submitted[1]!.resolve({}); await microtasks();
  expect(f.after).toEqual([0]); expect(f.submitted).toHaveLength(2);
  f.submitted[0]!.resolve({}); await microtasks();
  expect(f.after).toContain(1); expect(f.submitted).toHaveLength(3);
  f.submitted[2]!.resolve({}); await preparing;
});

it.each([3, 4] as const)('admits %i pending pipelines when requested and waits for a slot before submitting another', async limit => {
  const f = fixture(limit + 1), originalGet = f.pipelines.getForRender, originalCreate = f.backend.createRenderPipeline;
  const sequence = Array.from({ length: limit + 1 }, (_, index) => index);
  const preparing = withPipelineConcurrency(f.renderer, () => f.compile(), limit);
  let finished = false; void preparing.then(() => { finished = true; });
  await microtasks();
  expect(f.submitted).toHaveLength(limit); expect(f.built).toEqual(sequence.slice(0, limit));
  expect(f.after).toEqual(sequence.slice(0, limit - 1)); expect(f.scopes).toEqual([]);
  expect(f.popped).toEqual(sequence.slice(0, limit)); expect(f.backend.device).toBe(f.device);
  f.submitted[1]!.resolve({}); await microtasks();
  expect(f.submitted).toHaveLength(limit + 1); expect(f.peak()).toBe(limit);
  expect(f.results).toEqual([{ id: 1, scope: 1 }]);
  for (let index = limit; index >= 2; index--) { f.submitted[index]!.resolve({}); await microtasks(); }
  expect(f.after).toEqual(sequence); expect(finished).toBe(false);
  f.submitted[0]!.resolve({}); await preparing;
  expect(f.results.at(-1)).toEqual({ id: 0, scope: 0 }); expect(f.scopes).toEqual([]);
  expect(f.pipelines.getForRender).toBe(originalGet); expect(f.backend.createRenderPipeline).toBe(originalCreate);
});

it('drains the other pipeline on failure and restores the renderer before rejecting', async () => {
  const f = fixture(), originalGet = f.pipelines.getForRender, originalCreate = f.backend.createRenderPipeline;
  const failure = new Error('native compile failed');
  const preparing = withPipelineConcurrency(f.renderer, () => f.compile());
  let settled = false;
  const result = preparing.catch(error => { settled = true; return error; });
  await microtasks(); f.submitted[1]!.reject(failure); await microtasks();
  expect(settled).toBe(false); expect(f.submitted).toHaveLength(2);
  f.submitted[0]!.resolve({}); expect(await result).toBe(failure);
  expect(f.backend.device).toBe(f.device); expect(f.scopes).toEqual([]);
  expect(f.pipelines.getForRender).toBe(originalGet); expect(f.backend.createRenderPipeline).toBe(originalCreate);
});

it('drains a submitted pipeline when the native compile loop aborts', async () => {
  const f = fixture(), failure = new Error('node build failed');
  const preparing = withPipelineConcurrency(f.renderer, async () => {
    f.pipelines.getForRender(f.objects[0]!, []);
    throw failure;
  });
  let settled = false;
  const result = preparing.catch(error => { settled = true; return error; });
  await microtasks(); expect(settled).toBe(false);
  f.submitted[0]!.resolve({}); expect(await result).toBe(failure);
  expect(f.backend.device).toBe(f.device);
});

it('rejects incompatible or simultaneous native preparations before compiling', async () => {
  const f = fixture();
  const active = withPipelineConcurrency(f.renderer, () => f.compile(f.objects.slice(0, 1)));
  await microtasks();
  await expect(withPipelineConcurrency(f.renderer, async () => {})).rejects.toThrow('serialized');
  f.submitted[0]!.resolve({}); await active;
  (f.renderer as unknown as { _initialized: boolean })._initialized = false;
  await expect(withPipelineConcurrency(f.renderer, async () => {})).rejects.toThrow('initialized Three r185');
});
