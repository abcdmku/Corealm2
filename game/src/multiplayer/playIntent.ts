/**
 * What this page is here to play, and how it remembers.
 *
 * Three answers feed the loading-screen picker, and all three are plain data so they can be decided
 * and tested without a browser:
 *
 *  - `?play=` — a harness or a bookmark naming its target, which skips the picker entirely.
 *  - the last choice, in `localStorage`, which preselects a row but never joins on its own.
 *  - a pending launch, in `sessionStorage`, which is how the page changes asset host: the choice is
 *    written down, the page reloads, and the second boot sets the base before the first fetch.
 *
 * Nothing here touches the DOM beyond the two storages, and every read tolerates a browser that
 * refuses them (private mode, a sandboxed frame) by answering as if nothing were stored.
 */

/** A world is named `<providerId>/<worldId>`, which is the pair `worldKey` is built from. */
export type PlayTarget =
  | { readonly kind: "local" }
  | { readonly kind: "world"; readonly providerId: string; readonly worldId: string }
  /** Something was asked for that cannot name a world. The picker shows, and says so. */
  | { readonly kind: "invalid"; readonly value: string };

/** Ids come from world descriptors and directory URLs, so they are short and have no separators. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const LAST_CHOICE_KEY = "corealm.play.v1";
const PENDING_LAUNCH_KEY = "corealm.play.pending.v1";

/** `local`, `<providerId>/<worldId>`, or nothing. The same spelling as `?play=` and the stored choice. */
export function parsePlayTarget(value: string | null | undefined): PlayTarget | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (!text) return null;
  if (text === "local") return { kind: "local" };
  const slash = text.indexOf("/");
  const providerId = text.slice(0, slash), worldId = text.slice(slash + 1);
  if (slash <= 0 || !ID.test(providerId) || !ID.test(worldId)) return { kind: "invalid", value: text.slice(0, 120) };
  return { kind: "world", providerId, worldId };
}

/** The `play` parameter of a page URL. */
export function playTargetOf(search: string | URLSearchParams): PlayTarget | null {
  return parsePlayTarget((typeof search === "string" ? new URLSearchParams(search) : search).get("play"));
}

/** How a target is written down, in a URL or in storage. Invalid targets are never written. */
export function playTargetText(target: PlayTarget): string | null {
  return target.kind === "local" ? "local" : target.kind === "world" ? `${target.providerId}/${target.worldId}` : null;
}

/** What this browser played last. Local until it says otherwise: a first visit has nothing to join. */
export function lastPlayChoice(): PlayTarget {
  let stored: string | null = null;
  try { stored = localStorage.getItem(LAST_CHOICE_KEY); } catch { /* Private mode: this session starts fresh. */ }
  const target = parsePlayTarget(stored);
  return target === null || target.kind === "invalid" ? { kind: "local" } : target;
}

/** Remembered on every commit, never on a hover or an arrow key: it decides where focus starts next time. */
export function rememberPlayChoice(target: PlayTarget): void {
  const text = playTargetText(target);
  if (text === null) return;
  try { localStorage.setItem(LAST_CHOICE_KEY, text); } catch { /* Private mode: the choice still holds this session. */ }
}

/**
 * A world the page is reloading in order to reach, with the asset host it named.
 *
 * `attempts` counts the reloads already spent on it. One is allowed: if the second boot still finds
 * the host foreign, the base could not be taken and reloading again would only loop.
 */
export interface PendingLaunch {
  readonly providerId: string;
  readonly worldId: string;
  readonly assetBaseUrl: string;
  readonly attempts: number;
}

/** Read and clear, so a boot that fails on the way to the world does not repeat forever. */
export function takePendingLaunch(): PendingLaunch | null {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(PENDING_LAUNCH_KEY); sessionStorage.removeItem(PENDING_LAUNCH_KEY); }
  catch { return null; }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { providerId, worldId, assetBaseUrl, attempts } = value as Record<string, unknown>;
    if (!ID.test(String(providerId)) || !ID.test(String(worldId))) return null;
    if (typeof assetBaseUrl !== "string" || !/^https?:\/\//i.test(assetBaseUrl)) return null;
    return { providerId: String(providerId), worldId: String(worldId), assetBaseUrl,
      attempts: typeof attempts === "number" && Number.isSafeInteger(attempts) ? attempts : 0 };
  } catch { return null; }
}

/** Written immediately before `location.reload()`, and only then. */
export function storePendingLaunch(launch: PendingLaunch): void {
  try { sessionStorage.setItem(PENDING_LAUNCH_KEY, JSON.stringify(launch)); }
  catch { /* Without session storage the reload would forget why it happened, so the caller must not reload. */ }
}

/** True when `storePendingLaunch` will survive a reload. A page that cannot store must not reload. */
export function canStorePendingLaunch(): boolean {
  try {
    sessionStorage.setItem(`${PENDING_LAUNCH_KEY}.probe`, "1");
    sessionStorage.removeItem(`${PENDING_LAUNCH_KEY}.probe`);
    return true;
  } catch { return false; }
}

/** What joining a world costs this page. */
export type JoinRoute = "join" | "reload" | "refuse";

/**
 * Whether this page can join the world as it stands, has to reload onto the world's asset host
 * first, or cannot reach it at all.
 *
 * Boot resolves the asset base from the page's own deployment and starts fetching immediately, so
 * by the time a world is chosen the `AssetRegistry`, the shipped world records and the manifest are
 * all pinned to that origin. Re-pointing a live registry would leave a session holding half its
 * models from each host, which is why the answer is a reload rather than a rebase.
 *
 * `rebaseAttempts` is what the pending launch carried into this boot. One reload is allowed: if the
 * host is still foreign afterwards the page pinned its own base, or the world's base is unusable,
 * and reloading again would only loop.
 */
export function joinRoute(page: { assetHostForeign: boolean; rebaseAttempts: number; canStore: boolean }): JoinRoute {
  if (!page.assetHostForeign) return "join";
  return page.rebaseAttempts === 0 && page.canStore ? "reload" : "refuse";
}
