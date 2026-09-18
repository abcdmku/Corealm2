import type { EventBatch, GameEvent, GameEventType, EntityId } from "../contracts.js";

const MAX_BUFFER = 512;

interface Waiter {
  sinceSeq: number;
  filter?: GameEventType[];
  resolve(value: EventBatch): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Monotonic event ring buffer with cursor reads and long-poll waiters.
 *
 * Cursor + long-poll is what lets a good agent avoid polling entirely, which is the whole point of
 * the agent-efficiency pillar. Events are queued during a tick and flushed at the end of it, so
 * causally related events (level.gained then the quest.updated it triggers) stay ordered.
 *
 * The ring is bounded, and the bound used to be invisible: an agent that slept through 600 events
 * got the last 512 back with no sign that 88 were gone, then reconstructed its inventory from a
 * stream with a hole in it. Every read now reports the gap (`dropped`, `droppedCount`,
 * `oldestSeq`) so the caller can resync from state instead of trusting the stream.
 */
export class EventBus {
  private buffer: GameEvent[] = [];
  private pending: GameEvent[] = [];
  private waiters = new Set<Waiter>();
  private nextSeq = 1;
  /** Highest sequence number readers can actually observe in `buffer`. */
  private publishedSeq = 0;
  /** Lifetime count of published events trimmed off the front of the ring. */
  private trimmed = 0;
  private listeners = new Set<(event: GameEvent) => void>();
  private simulationListeners = new Set<(event: GameEvent) => void>();
  private simulationEnabled = true;

  setSimulationEnabled(enabled: boolean): void { this.simulationEnabled = enabled; }
  isSimulationEnabled(): boolean { return this.simulationEnabled; }

  /** Replicated outcomes may drive presentation, but cannot run local reward rules again. */
  subscribeSimulation(listener: (event: GameEvent) => void): () => void {
    this.simulationListeners.add(listener);
    return () => { this.simulationListeners.delete(listener); };
  }

  /** Queues an event. It becomes visible to readers at the next flush. */
  emit(type: GameEventType, data: Record<string, unknown> = {}, entityId?: EntityId, atMs = 0): void {
    const event: GameEvent = entityId
      ? { seq: this.nextSeq++, type, atMs, entityId, data }
      : { seq: this.nextSeq++, type, atMs, data };
    this.pending.push(event);
  }

  /** Publishes everything queued this tick. Called last in the update order, on purpose. */
  flush(): void {
    if (this.pending.length === 0) return;
    for (const event of this.pending) {
      this.buffer.push(event);
      this.publishedSeq = event.seq;
      if (this.simulationEnabled) for (const listener of this.simulationListeners) listener(event);
      for (const listener of this.listeners) listener(event);
    }
    this.pending.length = 0;
    if (this.buffer.length > MAX_BUFFER) {
      const excess = this.buffer.length - MAX_BUFFER;
      this.buffer.splice(0, excess);
      this.trimmed += excess;
    }
    this.wakeWaiters();
  }

  /** The first sequence still readable. Equals `nextSeq` when nothing is buffered. */
  oldestSeq(): number {
    return this.buffer.length > 0 ? this.buffer[0]!.seq : this.publishedSeq + 1;
  }

  /** Non-blocking drain from a cursor. */
  since(sinceSeq: number, filter?: GameEventType[]): EventBatch {
    const events = this.buffer.filter(
      (event) => event.seq > sinceSeq && (!filter || filter.length === 0 || filter.includes(event.type)),
    );
    const oldest = this.oldestSeq();
    // A cursor of 0 is "from the beginning" and is honest about a trimmed ring; any other cursor
    // older than the ring has missed everything between it and the oldest survivor.
    const droppedCount = this.trimmed > 0 && sinceSeq < oldest - 1 ? oldest - 1 - sinceSeq : 0;
    // `nextSeq` must never include an event that is still pending. A caller commonly saves this
    // cursor and asks again after the tick flush; advancing it to an unpublished sequence would
    // make that event disappear from the caller's history.
    return {
      events,
      nextSeq: this.publishedSeq,
      oldestSeq: oldest,
      dropped: droppedCount > 0,
      droppedCount,
    };
  }

  /** Long-poll. Resolves as soon as a matching event lands, or empty at timeout. */
  wait(sinceSeq: number, filter?: GameEventType[], timeoutMs = 30_000): Promise<EventBatch> {
    const immediate = this.since(sinceSeq, filter);
    if (immediate.events.length > 0) return Promise.resolve(immediate);

    return new Promise((resolve) => {
      const waiter: Waiter = {
        sinceSeq,
        ...(filter ? { filter } : {}),
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          resolve(this.since(sinceSeq, filter));
        }, Math.max(0, Math.min(timeoutMs, 120_000))),
      };
      this.waiters.add(waiter);
    });
  }

  /** In-process subscription, used by render and UI. Not the agent path. */
  subscribe(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private wakeWaiters(): void {
    if (this.waiters.size === 0) return;
    for (const waiter of [...this.waiters]) {
      const result = this.since(waiter.sinceSeq, waiter.filter);
      if (result.events.length > 0) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.resolve(result);
      }
    }
  }

  currentSeq(): number {
    return this.publishedSeq;
  }

  reset(): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ events: [], nextSeq: 0, oldestSeq: 1, dropped: false, droppedCount: 0 });
    }
    this.waiters.clear();
    this.buffer.length = 0;
    this.pending.length = 0;
    this.nextSeq = 1;
    this.publishedSeq = 0;
    this.trimmed = 0;
  }
}
