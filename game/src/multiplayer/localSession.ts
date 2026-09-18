import type { CommandOutcome, GameApi, GameCommand, WorldSession, WorldUpdate } from "../contracts.js";
import { command } from "./protocol.js";

export interface CommandExecutor {
  execute(command: GameCommand): ReturnType<GameApi["stop"]> | { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
  readonly tick: number;
}

/** Same command contract offline. The executor is the production gameplay runtime. */
export class LocalSession implements WorldSession {
  readonly world = null;
  private sequence = 0;
  private closed = false;
  constructor(readonly id: string, readonly playerId: string, private readonly executor: CommandExecutor) {}
  async command(input: GameCommand): Promise<CommandOutcome> {
    const sequence = ++this.sequence;
    if (this.closed) return { status: "rejected", sequence, tick: this.executor.tick, error: { code: "SESSION_EXPIRED", message: "Session is closed" } };
    try {
      const result = this.executor.execute(command(input));
      return result.ok
        ? { status: "accepted", sequence, tick: this.executor.tick, result: result.value }
        : { status: "rejected", sequence, tick: this.executor.tick, error: result.error };
    } catch {
      return { status: "rejected", sequence, tick: this.executor.tick, error: { code: "INVALID_MESSAGE", message: "Invalid command" } };
    }
  }
  subscribe(_listener: (update: WorldUpdate) => void): () => void { return () => {}; }
  async close(): Promise<void> { this.closed = true; }
}
