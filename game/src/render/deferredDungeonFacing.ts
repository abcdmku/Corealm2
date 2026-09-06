import type * as THREE from "three";
import { yieldToMainThread } from "../core/yield.js";
import { attachDungeonRockFacing, type BuiltDungeon, type CaveRockSource, type DungeonOptions, type DungeonSpec } from "./dungeon.js";

/** One cached interior load, shared by portal travel, restored saves, and the production cave lab. */
export class DeferredDungeonFacing {
  private pending: Promise<void> | null = null;
  private ready = false;
  private failure: string | null = null;

  constructor(
    private dungeon: BuiltDungeon,
    private spec: DungeonSpec,
    private options: DungeonOptions,
    private load: () => Promise<CaveRockSource>,
    private attached: (mesh: THREE.Mesh, source: CaveRockSource) => void,
  ) {}

  getState() { return { ready: this.ready, loading: this.pending !== null, error: this.failure }; }

  ensure(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.pending) return this.pending;
    this.failure = null;
    this.pending = Promise.resolve().then(this.load).then(async source => {
      await yieldToMainThread();
      const mesh = attachDungeonRockFacing(this.dungeon, this.spec, source, this.options);
      this.attached(mesh, source);
      this.ready = true;
    }).catch((error: unknown) => {
      this.failure = error instanceof Error ? error.message : String(error);
      throw error;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
}
