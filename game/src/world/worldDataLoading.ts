import type { GenerationCache } from './generationCache.js';
import type { WorldDataManifest } from './worldDataFormat.js';

export type WorldDataLoadTask = {
  id: number; revision: string; scope: string; key: string; terrainInput?: string;
} & ({ op: 'read' | 'has' } | { op: 'decode'; bytes: Uint8Array; entry: WorldDataManifest['records'][string] });
export type WorldDataLoadReply = {
  id: number; value?: unknown; error?: string; cache?: ReturnType<GenerationCache['snapshot']>;
};

/** One loading worker owns derived-data decoding and IndexedDB copies, not the render thread. */
export class WorldDataLoading {
  private nextId = 0;
  private failure: Error | null = null;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  cache: ReturnType<GenerationCache['snapshot']> | undefined;

  constructor(private readonly revision: string, private readonly scope: string,
    private readonly worker = new Worker(new URL('./worldData.worker.ts', import.meta.url), { type: 'module', name: 'corealm-content-loading' })) {
    worker.onmessage = (event: MessageEvent<WorldDataLoadReply>) => {
      const reply = event.data, job = this.pending.get(reply.id);
      if (!job) return;
      clearTimeout(job.timer); this.pending.delete(reply.id);
      if (reply.cache) this.cache = reply.cache;
      if (reply.error) job.reject(new Error(reply.error)); else job.resolve(reply.value);
    };
    worker.onerror = () => this.fail(new Error('World content loading worker failed'));
    worker.onmessageerror = () => this.fail(new Error('World content loading reply could not be read'));
  }

  private fail(error: Error): void {
    this.failure = error; this.worker.terminate();
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear();
  }

  run(task: ({ op: 'read' | 'has'; key: string } | { op: 'decode'; key: string; bytes: Uint8Array; entry: WorldDataManifest['records'][string] }) & { terrainInput?: string }): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('World content loading timed out')), 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ ...task, id, revision: this.revision, scope: this.scope } satisfies WorldDataLoadTask,
          task.op === 'decode' ? [task.bytes.buffer as ArrayBuffer] : []);
      } catch (cause) { this.fail(cause instanceof Error ? cause : new Error(String(cause))); }
    });
  }
}
