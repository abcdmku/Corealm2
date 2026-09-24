import { REVISION } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

type RenderObject = { getNodeBuilderState(): { updateAfterNodes: unknown[] } };
type PipelinePromise = Promise<unknown>;
interface Device {
  pushErrorScope(filter: string): void;
  popErrorScope(): Promise<unknown>;
  createRenderPipelineAsync(descriptor: unknown): Promise<unknown>;
}
interface Backend {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  parallel?: unknown;
  device: Device;
  createRenderPipeline(object: RenderObject, promises: PipelinePromise[] | null): void;
}
interface Pipelines {
  getForRender(object: RenderObject, promises?: PipelinePromise[] | null): unknown;
}
interface Internals { _initialized: boolean; backend: Backend; _pipelines: Pipelines | null }
const active = new WeakSet<WebGPURenderer>();

/** r185 captures the device before awaiting pipeline creation, but pops its validation
 * scope afterward. Give that invocation a device which closes the scope immediately
 * after submission and returns its saved result at the original pop. Other device
 * users always retain the real device, including across every asynchronous yield. */
function scopedPipelineDevice(device: Device): { device: Device; close(): void } {
  let open = false, captured = false;
  let result: Promise<unknown> | undefined;
  const close = () => {
    if (!open) return;
    open = false;
    result = device.popErrorScope();
    // The native helper consumes this later. Attach a handler now if it rejects early.
    void result.catch(() => {});
  };
  const proxy = new Proxy(device, {
    get(target, property) {
      if (property === 'pushErrorScope') return (filter: string) => {
        if (captured || filter !== 'validation') throw new Error('Unexpected native pipeline validation scope');
        captured = true;
        target.pushErrorScope(filter);
        open = true;
      };
      if (property === 'createRenderPipelineAsync') return (descriptor: unknown) => {
        if (!open) throw new Error('Native pipeline submission requires its validation scope');
        try { return target.createRenderPipelineAsync(descriptor); }
        finally { close(); }
      };
      if (property === 'popErrorScope') return () => {
        close();
        if (!result) throw new Error('Native pipeline validation scope was not captured');
        const pending = result;
        result = undefined;
        return pending;
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { device: proxy, close };
}

/** Keep Three's node building, geometry uploads, bindings, and per-object yields in
 * their native serial order. Only pipeline promises overlap, with bounded slots.
 * One preparation job may call compileAsync repeatedly under this adapter. The caller
 * retains each upload fence and publishes readiness only after the whole job resolves. */
export async function withPipelineConcurrency(renderer: WebGPURenderer, compile: () => Promise<void>, limit = 2): Promise<void> {
  const internal = renderer as unknown as Internals;
  const backend = internal.backend, pipelines = internal._pipelines;
  const native = backend?.isWebGPUBackend === true;
  const parallelWebGL = backend?.isWebGLBackend === true && Boolean(backend.parallel);
  if (REVISION !== '185' || internal._initialized !== true || (!native && !parallelWebGL)
    || !pipelines || typeof pipelines.getForRender !== 'function' || typeof backend.createRenderPipeline !== 'function'
    || (native && (typeof backend.device?.createRenderPipelineAsync !== 'function'
    || typeof backend.device.pushErrorScope !== 'function' || typeof backend.device.popErrorScope !== 'function'))) {
    throw new Error('Pipeline concurrency requires initialized Three r185 asynchronous pipeline stores');
  }
  if (active.has(renderer)) throw new Error('Pipeline preparation must remain serialized');
  active.add(renderer);
  const getForRender = pipelines.getForRender, createRenderPipeline = backend.createRenderPipeline;
  const pending = new Set<PipelinePromise>();
  let submitting = false, submittedCount = 0, failed = false, failure: unknown;
  const recordFailure = (error: unknown) => { if (!failed) { failed = true; failure = error; } };
  backend.createRenderPipeline = function (object, promises) {
    if (!submitting) return createRenderPipeline.call(this, object, promises);
    if (++submittedCount > 1 || pending.size >= limit) throw new Error('Unexpected native pipeline submission count');
    // WebGL's own promise resolves only after _completeCompile installs the program
    // bindings. Retain that whole promise; a GPU fence alone cannot replace it.
    if (!native) return createRenderPipeline.call(this, object, promises);
    const device = this.device, scoped = scopedPipelineDevice(device);
    this.device = scoped.device;
    try { return createRenderPipeline.call(this, object, promises); }
    finally { this.device = device; scoped.close(); }
  };
  pipelines.getForRender = function (object, promises = null) {
    // Normal rendering uses null and must never enter the asynchronous pool.
    if (promises === null) return getForRender.call(this, object, promises);
    if (!Array.isArray(promises) || typeof object.getNodeBuilderState !== 'function'
      || !Array.isArray(object.getNodeBuilderState().updateAfterNodes)) {
      throw new Error('Unexpected native asynchronous pipeline shape');
    }
    if (failed) throw failure;
    if (pending.size >= limit) throw new Error(`Native pipeline concurrency exceeded ${limit} submissions`);
    const submitted: PipelinePromise[] = [];
    let pipeline: unknown;
    submitting = true;
    submittedCount = 0;
    try { pipeline = getForRender.call(this, object, submitted); }
    finally {
      submitting = false;
      for (const promise of submitted) {
        pending.add(promise);
        void promise.then(() => pending.delete(promise), error => { recordFailure(error); pending.delete(promise); });
      }
    }
    if (submitted.length > 1) throw new Error('Unexpected native pipeline submission count');
    if (object.getNodeBuilderState().updateAfterNodes.length > 0) {
      // Such nodes may depend on completion. Preserve native updateAfter ordering.
      promises.push(...pending);
    } else if (pending.size >= limit) promises.push(Promise.race(pending));
    return pipeline;
  };
  try { await compile(); }
  catch (error) { recordFailure(error); }
  finally {
    await Promise.allSettled([...pending]);
    pipelines.getForRender = getForRender;
    backend.createRenderPipeline = createRenderPipeline;
    active.delete(renderer);
  }
  if (failed) throw failure;
}
