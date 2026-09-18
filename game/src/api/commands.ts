import { GAME_ERROR_CODES, type GameErrorCode, type GameApi, type GameCommand, type GameCommandMethod, type Result } from "../contracts.js";

/** UI, input, and agent callers share the same asynchronous authority boundary. */
export async function sendGameCommand<K extends GameCommandMethod>(api: GameApi, method: K, ...args: Parameters<GameApi[K]>): Promise<ReturnType<GameApi[K]>> {
  if (!api.submit) {
    // Structural local test adapters and embedded offline integrations retain their executor.
    const invoke = api[method] as (...args: unknown[]) => ReturnType<GameApi[K]>;
    return invoke.apply(api, args);
  }
  let outcome;
  try { outcome = await api.submit({ method, args } as GameCommand); }
  catch { return { ok: false, error: { code: "UNKNOWN_OUTCOME", message: "World command outcome is unknown. Reconnect before retrying." } } as ReturnType<GameApi[K]>; }
  const result: Result<unknown> = outcome.status === "accepted" ? { ok: true, value: outcome.result }
    : { ok: false, error: { code: outcome.status === "unknown" ? "UNKNOWN_OUTCOME"
      : GAME_ERROR_CODES.includes(outcome.error.code as GameErrorCode) ? outcome.error.code as GameErrorCode : "UNAVAILABLE", message: outcome.error.message } };
  return result as ReturnType<GameApi[K]>;
}
