import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameEvent } from "../game/src/contracts.js";
import {
  AudioDirector, AudioEngine, cueForActivity, cueForGameEvent, cueForMovement,
  cuesForCombatHit, defineAudioCatalog, loopsForRegion,
} from "../game/src/audio/index.js";

afterEach(() => vi.restoreAllMocks());

class FakeParam {
  value = 1;
  readonly changes: { kind: "set" | "ramp"; value: number; at: number }[] = [];

  cancelScheduledValues(): this { return this; }
  setValueAtTime(value: number, at: number): this {
    this.value = value;
    this.changes.push({ kind: "set", value, at });
    return this;
  }
  linearRampToValueAtTime(value: number, at: number): this {
    this.value = value;
    this.changes.push({ kind: "ramp", value, at });
    return this;
  }
}

class FakeGain {
  readonly gain = new FakeParam();
  disconnected = false;
  connect(): void {}
  disconnect(): void { this.disconnected = true; }
}

class FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  started = false;
  stopCalls = 0;
  stopAt: number | undefined;
  disconnected = false;

  connect(): void {}
  disconnect(): void { this.disconnected = true; }
  start(): void { this.started = true; }
  stop(when?: number): void { this.stopCalls += 1; this.stopAt = when; }
  end(): void { this.onended?.(); }
}

class FakeContext {
  readonly panners: Array<FakeGain & { positionX: FakeParam; positionY: FakeParam; positionZ: FakeParam; panningModel: string; distanceModel: string; maxDistance: number }> = [];
  readonly listener = Object.fromEntries(["positionX", "positionY", "positionZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"].map(key => [key, new FakeParam()]));
  createPanner(): PannerNode {
    const panner = Object.assign(new FakeGain(), { positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam(), panningModel: "", distanceModel: "", maxDistance: 0 });
    this.panners.push(panner);
    return panner as unknown as PannerNode;
  }
  state: AudioContextState = "suspended";
  currentTime = 2;
  readonly destination = {} as AudioDestinationNode;
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  resumeCalls = 0;
  decodeCalls = 0;
  allowResume = true;

  createGain(): GainNode {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }
  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
  async decodeAudioData(): Promise<AudioBuffer> {
    this.decodeCalls += 1;
    return { duration: 1 } as AudioBuffer;
  }
  async resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.allowResume) this.state = "running";
  }
  async close(): Promise<void> { this.state = "closed"; }
}

function okFetcher() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as Response));
}

const catalog = defineAudioCatalog({
  cues: {
    "ui.click": { variants: ["test:shared"], minIntervalMs: 100, maxConcurrent: 2 },
    "ui.confirm": { variants: ["test:shared"], minIntervalMs: 0 },
  },
  loops: {
    plain: { url: "test:plain", bus: "music", gain: 0.5, fadeMs: 1000 },
    woods: { url: "test:woods", bus: "music", gain: 0.6, fadeMs: 1000 },
    wind: { url: "test:wind", bus: "ambient", fadeMs: 500 },
  },
  regions: {
    fallowmarch: { music: ["plain", "woods"], ambient: "wind" },
    gravelmaw: {},
  },
});

const orderedVariantCatalog = defineAudioCatalog({
  cues: {
    "ui.level_up": {
      variants: ["test:variant-a", "test:variant-b", "test:variant-c"],
      minIntervalMs: 0,
      maxConcurrent: 8,
      playbackRate: [0.8, 1.2],
    },
    "ui.confirm": {
      variants: ["test:confirm-a", "test:confirm-b"],
      minIntervalMs: 0,
      maxConcurrent: 8,
      playbackRate: [0.9, 1.1],
    },
  },
});

function createEngine(
  context = new FakeContext(),
  overrides: { nowMs?: () => number; fetcher?: typeof fetch } = {},
) {
  const fetcher = overrides.fetcher ?? okFetcher();
  const engine = new AudioEngine(catalog, {
    contextFactory: () => context as unknown as AudioContext,
    fetcher,
    nowMs: overrides.nowMs,
  });
  return { engine, context, fetcher };
}

describe("AudioEngine buses and unlock", () => {
  it("positions animal audio relative to the camera listener and releases its panner on travel", async () => {
    const { engine, context } = createEngine();
    engine.setListenerPose([1, 2, 3], [2, 0, 0]);
    expect(await engine.playCue("ui.click", { position: [10, 2, 3], maxDistance: 34 })).toBe(true);
    expect(context.panners).toHaveLength(1);
    const panner = context.panners[0]!;
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([10, 2, 3]);
    expect(panner.panningModel).toBe("HRTF");
    expect(panner.distanceModel).toBe("linear");
    expect(context.listener.positionX!.value).toBe(1);
    expect(context.listener.forwardX!.value).toBe(1);
    expect(engine.resetOneShots()).toBe(1);
    expect(panner.disconnected).toBe(true);
  });

  it("keeps UI cues centred and ignores invalid spatial coordinates", async () => {
    const { engine, context } = createEngine();
    await engine.playCue("ui.confirm");
    await engine.playCue("ui.click", { position: [NaN, 0, 0] });
    expect(context.panners).toHaveLength(0);
  });

  it("clamps independent volume buses and applies a true zero", async () => {
    const { engine, context } = createEngine();
    engine.setVolumes({ music: 3, ambient: -2, sfx: Number.NaN });
    expect(engine.getVolumes()).toEqual({ music: 1, ambient: 0, sfx: 0 });

    await engine.unlock();
    expect(context.gains.slice(0, 3).map((gain) => gain.gain.value)).toEqual([1, 0, 0]);
    engine.setVolume("sfx", 0.25);
    expect(context.gains.slice(0, 3).map((gain) => gain.gain.value)).toEqual([1, 0, 0.25]);
  });

  it("keeps gesture listeners until resume works, then removes them", async () => {
    const { engine, context } = createEngine();
    const target = new EventTarget();
    context.allowResume = false;
    engine.installGestureUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    await vi.waitFor(() => expect(context.resumeCalls).toBe(1));
    expect(engine.isUnlocked()).toBe(false);
    await Promise.resolve();
    await Promise.resolve();

    context.allowResume = true;
    target.dispatchEvent(new Event("keydown"));
    await vi.waitFor(() => expect(engine.isUnlocked()).toBe(true));
    expect(context.resumeCalls).toBe(2);

    context.state = "suspended";
    target.dispatchEvent(new Event("touchstart"));
    await Promise.resolve();
    expect(context.resumeCalls).toBe(2);
  });

  it("decodes selected one-shots on the gesture that unlocks audio", async () => {
    const { engine, context, fetcher } = createEngine();
    const target = new EventTarget();
    engine.installGestureUnlock(target, ["test:shared"]);

    target.dispatchEvent(new Event("pointerdown"));
    await vi.waitFor(() => expect(context.decodeCalls).toBe(1));

    expect(fetcher).toHaveBeenCalledWith("test:shared");
    expect(engine.snapshot().cachedBuffers).toBe(1);
  });

  it("decodes selected one-shots when another system unlocks audio first", async () => {
    const { engine, context, fetcher } = createEngine();
    engine.installGestureUnlock(null, ["test:shared"]);

    await engine.unlock();
    await vi.waitFor(() => expect(context.decodeCalls).toBe(1));

    expect(fetcher).toHaveBeenCalledWith("test:shared");
    expect(engine.snapshot().cachedBuffers).toBe(1);
  });
});

describe("AudioEngine one-shots", () => {
  it("plays cue variants in a per-cue round-robin sequence without randomness", async () => {
    const context = new FakeContext();
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("cue playback must not consult randomness");
    });
    const engine = new AudioEngine(orderedVariantCatalog, {
      contextFactory: () => context as unknown as AudioContext,
      fetcher: okFetcher(),
    });

    await expect(engine.playCue("ui.level_up")).resolves.toBe(true);
    await expect(engine.playCue("ui.confirm")).resolves.toBe(true);
    await expect(engine.playCue("ui.level_up")).resolves.toBe(true);
    await expect(engine.playCue("ui.confirm")).resolves.toBe(true);
    await expect(engine.playCue("ui.level_up")).resolves.toBe(true);
    await expect(engine.playCue("ui.level_up")).resolves.toBe(true);

    expect(engine.history().filter((entry) => entry.kind === "cue").map((entry) => entry.url)).toEqual([
      "test:variant-a", "test:confirm-a", "test:variant-b", "test:confirm-b",
      "test:variant-c", "test:variant-a",
    ]);
    expect(context.sources.map((source) => source.playbackRate.value)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it("resets each cue's ordered variant cursor on reset and dispose", async () => {
    const context = new FakeContext();
    const engine = new AudioEngine(orderedVariantCatalog, {
      contextFactory: () => context as unknown as AudioContext,
      fetcher: okFetcher(),
    });

    await expect(engine.playCue("ui.level_up")).resolves.toBe(true);
    await expect(engine.playCue("ui.level_up")).resolves.toBe(true);
    expect(engine.history().filter((entry) => entry.kind === "cue").at(-1)?.url)
      .toBe("test:variant-b");

    engine.resetOneShots();
    engine.clearHistory();
    await expect(engine.playCue("ui.level_up")).resolves.toBe(true);
    expect(engine.history().filter((entry) => entry.kind === "cue").at(-1)?.url)
      .toBe("test:variant-a");

    await engine.dispose();
    expect((engine as unknown as { cueVariantIndexes: Map<string, number> }).cueVariantIndexes.size)
      .toBe(0);
  });

  it("caches decoded buffers and enforces interval and polyphony limits", async () => {
    let now = 0;
    const { engine, context, fetcher } = createEngine(new FakeContext(), { nowMs: () => now });
    expect(await engine.playCue("ui.click")).toBe(true);
    expect(await engine.playCue("ui.click")).toBe(false);

    now = 100;
    expect(await engine.playCue("ui.click")).toBe(true);
    now = 200;
    expect(await engine.playCue("ui.click")).toBe(false);
    context.sources[0]!.end();
    expect(await engine.playCue("ui.click")).toBe(true);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(context.decodeCalls).toBe(1);
    expect(engine.history().map((entry) => entry.kind === "cue" ? entry.cue : entry.kind)).toEqual([
      "ui.click", "ui.click", "ui.click",
    ]);
  });

  it("drops muted cues before fetch and contains fetch failures", async () => {
    const diagnostics: string[] = [];
    const failedFetch = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const context = new FakeContext();
    const engine = new AudioEngine(catalog, {
      contextFactory: () => context as unknown as AudioContext,
      fetcher: failedFetch,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.kind),
    });

    engine.setVolume("sfx", 0);
    expect(await engine.playCue("ui.click")).toBe(false);
    expect(failedFetch).not.toHaveBeenCalled();
    engine.setVolume("sfx", 1);
    expect(await engine.playCue("ui.click")).toBe(false);
    expect(diagnostics).toEqual(["fetch-failed"]);
  });

  it("keeps pending reservations accurate when another voice ends", async () => {
    let releaseFetch!: (response: Response) => void;
    const deferred = new Promise<Response>((resolve) => { releaseFetch = resolve; });
    const fetcher = vi.fn((url: RequestInfo | URL) =>
      String(url) === "test:pending" ? deferred : Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as Response)) as unknown as typeof fetch;
    const context = new FakeContext();
    const engine = new AudioEngine(defineAudioCatalog({
      cues: {
        "ui.click": { variants: ["test:active"], minIntervalMs: 0 },
        "ui.confirm": { variants: ["test:pending"], minIntervalMs: 0 },
      },
    }), {
      contextFactory: () => context as unknown as AudioContext,
      fetcher,
    });

    expect(await engine.playCue("ui.click")).toBe(true);
    const pendingPlay = engine.playCue("ui.confirm");
    await vi.waitFor(() => expect(engine.snapshot().pendingOneShots).toBe(1));
    context.sources[0]!.end();
    expect(engine.snapshot().pendingOneShots).toBe(1);

    releaseFetch({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as Response);
    expect(await pendingPlay).toBe(true);
    expect(engine.snapshot()).toMatchObject({ activeOneShots: 1, pendingOneShots: 0 });
  });

  it("invalidates pending one-shots when the world resets", async () => {
    let releaseFetch!: (response: Response) => void;
    const deferred = new Promise<Response>((resolve) => { releaseFetch = resolve; });
    const context = new FakeContext();
    const engine = new AudioEngine(catalog, {
      contextFactory: () => context as unknown as AudioContext,
      fetcher: vi.fn(() => deferred) as unknown as typeof fetch,
    });

    const pendingPlay = engine.playCue("ui.click");
    await vi.waitFor(() => expect(engine.snapshot().pendingOneShots).toBe(1));
    engine.resetOneShots();
    expect(engine.snapshot()).toMatchObject({ activeOneShots: 0, pendingOneShots: 0 });

    releaseFetch({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as Response);
    expect(await pendingPlay).toBe(false);
    expect(context.sources).toHaveLength(0);
    expect(engine.history()).toHaveLength(0);
  });

  it("stops and forgets active one-shots when the world resets", async () => {
    const { engine, context } = createEngine();
    expect(await engine.playCue("ui.click")).toBe(true);
    expect(engine.snapshot().activeOneShots).toBe(1);

    expect(engine.resetOneShots()).toBe(1);
    expect(engine.snapshot()).toMatchObject({ activeOneShots: 0, pendingOneShots: 0 });
    expect(context.sources[0]?.stopCalls).toBe(1);
    expect(context.sources[0]?.disconnected).toBe(true);
  });
});

describe("AudioEngine loops", () => {
  it("starts a pending loop after gesture unlock and crossfades by name", async () => {
    const { engine, context } = createEngine();
    context.allowResume = false;
    expect(await engine.startLoop("plain")).toBe(false);
    expect(engine.snapshot().desiredLoops).toEqual(["plain"]);

    context.allowResume = true;
    const target = new EventTarget();
    engine.installGestureUnlock(target);
    target.dispatchEvent(new Event("pointerdown"));
    await vi.waitFor(() => expect(engine.snapshot().activeLoops).toEqual(["plain"]));

    expect(await engine.crossfade("plain", "woods", 500)).toBe(true);
    expect(engine.snapshot().activeLoops).toEqual(["woods"]);
    expect(context.sources[0]!.stopAt).toBe(2.5);
    expect(engine.history().map((entry) => entry.kind)).toEqual([
      "loop-start", "loop-start", "loop-stop",
    ]);

    await engine.dispose();
    expect(context.state).toBe("closed");
    expect(engine.snapshot().disposed).toBe(true);
  });
});

describe("semantic cue selection", () => {
  it("maps events, activity families, combat hits, movement, and region loops", () => {
    const event: GameEvent = {
      seq: 1,
      type: "level.gained",
      atMs: 20,
      data: { skill: "mining" },
    };
    expect(cueForGameEvent(event)).toBe("ui.level_up");
    expect(cueForActivity({ kind: "gathering", skill: "mining", phase: "started" }))
      .toBe("gather.mining_swing");
    expect(cueForActivity({ kind: "production", skill: "smithing", op: "smelt", phase: "completed" }))
      .toBe("production.smelt");
    expect(cueForActivity({ kind: "production", skill: "smithing", phase: "completed" })).toBeNull();
    expect(cueForGameEvent({
      seq: 2,
      type: "activity.started",
      atMs: 30,
      data: { kind: "traversing", via: "portal" },
    })).toBe("interaction.portal");
    expect(cuesForCombatHit({ attacker: "player", damage: 4, hit: true, kind: "melee", killed: true }))
      .toEqual(["combat.melee_swing", "combat.melee_hit", "combat.enemy_death"]);
    expect(cueForMovement({ regionId: "vellenwood" })).toBe("movement.footstep_forest");
    expect(cueForMovement({ regionId: "gravelmaw", surface: "wood" })).toBe("movement.footstep_wood");
    expect(loopsForRegion("fallowmarch", catalog.regions)).toEqual({ music: "plain", ambient: "wind" });
    expect(loopsForRegion("fallowmarch", catalog.regions, 1)).toEqual({ music: "woods", ambient: "wind" });
    expect(loopsForRegion("fallowmarch", catalog.regions, 2)).toEqual({ music: "plain", ambient: "wind" });
    expect(loopsForRegion("gravelmaw", catalog.regions)).toEqual({ music: null, ambient: null });
  });

  it("does not let a stale A to B to A transition cancel the newest A loop", async () => {
    const pending = new Map<string, Array<(started: boolean) => void>>();
    const stops: string[] = [];
    const fakeEngine = {
      startLoop: (name: string) => new Promise<boolean>((resolve) => {
        const queue = pending.get(name) ?? [];
        queue.push(resolve);
        pending.set(name, queue);
      }),
      crossfade: (_from: string, to: string) => new Promise<boolean>((resolve) => {
        const queue = pending.get(to) ?? [];
        queue.push(resolve);
        pending.set(to, queue);
      }),
      stopLoop: (name: string) => { stops.push(name); return true; },
      snapshot: () => ({ activeLoops: [] }),
      playCue: async () => true,
    };
    const raceCatalog = defineAudioCatalog({
      loops: {
        a: { url: "test:a", bus: "music" },
        b: { url: "test:b", bus: "music" },
      },
      regions: {
        fallowmarch: { music: "a" },
        vellenwood: { music: "b" },
      },
    });
    const director = new AudioDirector(fakeEngine as unknown as AudioEngine, raceCatalog);

    director.setRegion("fallowmarch");
    director.setRegion("vellenwood");
    director.setRegion("fallowmarch");
    pending.get("a")?.[0]?.(true);
    await Promise.resolve();
    expect(stops).not.toContain("a");

    pending.get("a")?.[1]?.(true);
    pending.get("b")?.[0]?.(true);
    await Promise.resolve();
    expect(stops).toContain("b");
    expect(stops).not.toContain("a");
  });

  it("rewinds ordered region music when the world resets", () => {
    const starts: string[] = [];
    const fakeEngine = {
      startLoop: async (name: string) => { starts.push(name); return true; },
      stopLoop: () => true,
      snapshot: () => ({ activeLoops: [] }),
      playCue: async () => true,
    };
    const director = new AudioDirector(fakeEngine as unknown as AudioEngine, catalog);

    director.setRegion("fallowmarch");
    director.setRegion("gravelmaw");
    director.setRegion("fallowmarch");
    director.reset("fallowmarch");

    expect(starts.filter((name) => name === "plain" || name === "woods"))
      .toEqual(["plain", "woods", "plain"]);
  });

  it("reset into a silent region stops old music and ambience", async () => {
    const fakeEngine = {
      startLoop: async () => true,
      stopLoop: vi.fn(),
      snapshot: () => ({ activeLoops: [] }),
    };
    const director = new AudioDirector(fakeEngine as unknown as AudioEngine, catalog);
    director.setRegion("fallowmarch");
    await Promise.resolve();
    director.reset("gravelmaw");
    expect(fakeEngine.stopLoop).toHaveBeenCalledWith("plain", 1200);
    expect(fakeEngine.stopLoop).toHaveBeenCalledWith("wind", 1200);
    director.dispose();
  });
});
