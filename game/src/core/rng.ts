/**
 * Seeded RNG. One stream per concern so that consuming a combat roll cannot shift a scatter layout.
 * mulberry32 — small, fast, and good enough for gameplay rolls.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inclusive on both ends. */
  int(min: number, max: number): number {
    if (max < min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(values: readonly T[]): T | undefined {
    if (values.length === 0) return undefined;
    return values[Math.floor(this.next() * values.length)];
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}

export type RngStreamId = "gather" | "combat" | "loot" | "scatter" | "world" | "misc";
export type RngStreamState = Record<RngStreamId,number>;

const STREAM_OFFSETS: Record<RngStreamId, number> = {
  gather: 0x1111,
  combat: 0x2222,
  loot: 0x3333,
  scatter: 0x4444,
  world: 0x5555,
  misc: 0x6666,
};

/** Independent, reproducible streams derived from one master seed. */
export class RngStreams {
  private streams = new Map<RngStreamId, Rng>();

  constructor(private seed: number) {
    this.reseed(seed);
  }

  reseed(seed: number): void {
    this.seed = seed >>> 0;
    this.streams.clear();
    for (const id of Object.keys(STREAM_OFFSETS) as RngStreamId[]) {
      this.streams.set(id, new Rng((this.seed ^ STREAM_OFFSETS[id]) >>> 0));
    }
  }

  get(id: RngStreamId): Rng {
    const stream = this.streams.get(id);
    if (stream) return stream;
    const created = new Rng((this.seed ^ STREAM_OFFSETS[id]) >>> 0);
    this.streams.set(id, created);
    return created;
  }

  getSeed(): number {
    return this.seed;
  }
  snapshot():RngStreamState {
    return Object.fromEntries([...this.streams].map(([id,stream])=>[id,stream.getState()])) as RngStreamState;
  }
  restore(state:RngStreamState):void {
    for(const id of Object.keys(STREAM_OFFSETS) as RngStreamId[]) {
      if(!Number.isSafeInteger(state[id])||state[id]<0||state[id]>0xffffffff)throw new Error("Invalid saved random stream");
    }
    for(const id of Object.keys(STREAM_OFFSETS) as RngStreamId[])this.get(id).setState(state[id]);
  }
}
