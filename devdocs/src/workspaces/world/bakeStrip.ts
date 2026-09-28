import type { ServerWorldBake, WorldBakeStatus } from "../../../../game/src/world/serverWorldContract.js";
import { BAKE_STEPS, type BakeStepName, type WorldStatus } from "../../api/worldBake.js";

/*
  What the World workspace's status strip shows, from the server's world status or, in repo mode, from
  nothing. Pure, so every state is a unit test rather than a screenshot.
*/

export type StepState = "done" | "running" | "failed" | "waiting";
export type StripTone = "ok" | "info" | "warn" | "danger";

export interface StripView {
  /** The world's geometry, in a few words. */
  world: { label: string; revision?: string; tone: StripTone };
  /** The bake to show: the running one, or the last one when it failed. */
  bake?: { label: string; tone: StripTone; steps: { name: BakeStepName; state: StepState; ms?: number }[]; elapsed?: string; error?: string; retry: boolean };
  /** One sentence for an author who wants to know what happens to a geometry edit. */
  note: string;
  history: { revision: string; label: string; tone: StripTone; when: string }[];
  /** Read the status again soon: a bake is queued or running. */
  poll: boolean;
  /** The map image does not show the world this server runs: the base world's, or an earlier bake's. */
  mapStale: boolean;
}

export const short = (revision: string): string => revision.slice(0, 10);

/** `1 m 04 s`, `12 s`. */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} m ${String(seconds % 60).padStart(2, "0")} s`;
}

const time = (value: string | undefined): number | undefined => { const at = value ? Date.parse(value) : NaN; return Number.isFinite(at) ? at : undefined; };

function stepStates(bake: ServerWorldBake): { name: BakeStepName; state: StepState; ms?: number }[] {
  let running = bake.status === "baking";
  return BAKE_STEPS.map(name => {
    const step = bake.steps?.find(row => row.name === name);
    const ms = step?.ms;
    const state: StepState = step?.ok === true || bake.status === "ready" ? "done" : step?.ok === false ? "failed" : running ? "running" : "waiting";
    if (state === "running") running = false;
    return { name, state, ...(ms === undefined ? {} : { ms }) };
  });
}

const BAKE_LABEL: Record<WorldBakeStatus, string> = { queued: "Bake queued", baking: "Baking the world", ready: "Baked", failed: "Bake failed", superseded: "Superseded" };
const BAKE_TONE: Record<WorldBakeStatus, StripTone> = { queued: "info", baking: "info", ready: "ok", failed: "danger", superseded: "warn" };

/**
 * What the strip shows, in repo mode (`undefined` status) or for a server's status at `now`.
 * `mapRevision` is the world the server's own rendered map shows, if it has one it can use.
 */
export function stripView(status: WorldStatus | undefined, now: number, mapRevision?: string): StripView {
  if (!status) return {
    world: { label: "Repository world", tone: "info" },
    note: "Geometry edits (terrain, regions, resource placements) need `npm run world:build` before they ship. The repository has no server bake.",
    history: [], poll: false, mapStale: false,
  };
  const latest = status.history[0];
  const shown = status.active ?? (latest?.status === "failed" ? latest : undefined);
  const running = status.active && (status.active.status === "queued" || status.active.status === "baking");
  let bake: StripView["bake"];
  if (shown) {
    const start = time(shown.startedAt) ?? time(shown.queuedAt);
    const end = time(shown.finishedAt) ?? (running ? now : undefined);
    bake = {
      label: BAKE_LABEL[shown.status], tone: BAKE_TONE[shown.status], steps: stepStates(shown),
      ...(start !== undefined && end !== undefined ? { elapsed: duration(end - start) } : {}),
      ...(shown.error ? { error: shown.error } : {}),
      retry: shown.status === "failed" && status.canBake && !running,
    };
  }
  return {
    world: status.base ? { label: "Matches the base game", revision: short(status.revision), tone: "ok" } : { label: "Baked on this server", revision: short(status.revision), tone: "info" },
    ...(bake ? { bake } : {}),
    note: running ? "Worlds restart on it once it passes."
      : shown?.status === "failed" ? "The last good world keeps running."
      : "Publishing terrain, region or resource placement edits bakes the world here.",
    history: status.history.filter(entry => entry !== shown).slice(0, 4).map(entry => ({
      revision: short(entry.revision), label: BAKE_LABEL[entry.status], tone: BAKE_TONE[entry.status], when: entry.finishedAt ?? entry.queuedAt,
    })),
    poll: Boolean(running),
    mapStale: !status.base && mapRevision !== status.revision,
  };
}
