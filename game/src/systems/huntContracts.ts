import type { GameEvent, Result, SemanticEntity } from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { EventBus } from "../core/events.js";
import { eligibleHuntTargets, generateHuntOffers, type HuntEligibility, type HuntOffer, type HuntTarget } from "../content/huntContracts.js";
import { huntEnemyDefMatches } from "../content/enemies.js";

export interface HuntProgress {
  offer: HuntOffer;
  status: "active" | "ready" | "claimed";
  kills: number;
  acceptedAfterSerial: number;
  lastCreditedSerial: number;
}
export interface HuntContractsState {
  version: 1;
  seed: number;
  offerSerial: number;
  /** Combat increments this only for a real credited death, before emitting combat.ended. */
  killSerial: number;
  offers: HuntOffer[];
  active: HuntProgress | null;
  completedCount: number;
  lastTargetId: string | null;
}
export function createInitialHuntContracts(seed = 1337): HuntContractsState {
  return { version: 1, seed: seed >>> 0, offerSerial: 0, killSerial: 0, offers: [], active: null,
    completedCount: 0, lastTargetId: null };
}
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const regions = new Set(["fallowmarch", "vellenwood", "karrowmoor", "kilnhalt", "gravelmaw", "wilderness"]);
function validOffer(o: HuntOffer): boolean {
  return !!o && typeof o.id === "string" && o.id.length > 0 && typeof o.targetId === "string"
    && typeof o.targetName === "string" && typeof o.regionName === "string" && regions.has(o.regionId)
    && Array.isArray(o.enemyDefIds) && o.enemyDefIds.length > 0 && o.enemyDefIds.every((id) => typeof id === "string" && id.length > 0)
    && integer(o.level) && o.level > 0 && integer(o.requiredKills) && o.requiredKills >= 4 && o.requiredKills <= 8
    && o.rewardXp === o.requiredKills * (12 + o.level * 4) && o.rewardSkill === "melee";
}
/** Missing data is an old save. Malformed present data is rejected, never silently rewarded. */
export function normalizeHuntContracts(raw: unknown, seed = 1337): HuntContractsState {
  if (raw === undefined) return createInitialHuntContracts(seed);
  const s = raw as HuntContractsState;
  if (!s || s.version !== 1 || !integer(s.seed) || !integer(s.offerSerial) || !integer(s.killSerial)
    || !integer(s.completedCount) || !(s.lastTargetId === null || typeof s.lastTargetId === "string")
    || !Array.isArray(s.offers) || s.offers.length > 3 || !s.offers.every(validOffer)
    || new Set(s.offers.map((o) => o.id)).size !== s.offers.length) throw new Error("Invalid hunt contract save");
  const a = s.active;
  if (a !== null && (!a || !validOffer(a.offer) || !["active", "ready", "claimed"].includes(a.status)
    || !integer(a.kills) || a.kills > a.offer.requiredKills || !integer(a.acceptedAfterSerial)
    || !integer(a.lastCreditedSerial) || a.lastCreditedSerial < a.acceptedAfterSerial || a.lastCreditedSerial > s.killSerial
    || (a.status === "active" ? a.kills >= a.offer.requiredKills : a.kills !== a.offer.requiredKills))) {
    throw new Error("Invalid hunt progress save");
  }
  return structuredClone(s);
}

export interface HuntContractsDeps {
  state(): HuntContractsState;
  markDirty(): void;
  events: EventBus;
  playerId(): string;
  targets(): readonly HuntTarget[];
  eligibility(): HuntEligibility;
  entity(id: string): SemanticEntity | undefined;
  /** Production XP award is synchronous; it must update the same saved state without throwing. */
  awardXp(skill: "melee", xp: number): void;
}

export class HuntContractsSystem {
  private readonly unsubscribe: () => void;
  constructor(private readonly deps: HuntContractsDeps) {
    this.unsubscribe = deps.events.subscribe((event) => this.onEvent(event));
  }
  dispose(): void { this.unsubscribe(); }
  snapshot(): HuntContractsState { return structuredClone(this.deps.state()); }
  refreshOffers(): Result<HuntOffer[]> {
    const state = this.deps.state();
    if (state.active && state.active.status !== "claimed") return err("INVALID_ARGUMENT", "Finish or abandon your current hunt first.");
    state.offerSerial += 1;
    state.offers = generateHuntOffers(state.seed, state.offerSerial, this.deps.targets(), this.deps.eligibility(), state.lastTargetId);
    this.changed("offers");
    return ok(structuredClone(state.offers));
  }
  accept(id: string): Result<HuntProgress> {
    const state = this.deps.state();
    if (state.active && state.active.status !== "claimed") {
      return state.active.offer.id === id ? ok(structuredClone(state.active)) : err("INVALID_ARGUMENT", "You already have an active hunt.");
    }
    const offer = state.offers.find((candidate) => candidate.id === id);
    if (!offer) return err("NOT_FOUND", "That hunt offer is no longer on the board.");
    if (!eligibleHuntTargets(this.deps.targets(), this.deps.eligibility()).some((target) => target.id === offer.targetId
      && offer.enemyDefIds.every((enemyId) => target.enemyDefIds.includes(enemyId)))) {
      return err("REQUIREMENTS_NOT_MET", "This hunt is no longer reachable. Refresh the board.");
    }
    state.active = { offer: structuredClone(offer), status: "active", kills: 0,
      acceptedAfterSerial: state.killSerial, lastCreditedSerial: state.killSerial };
    state.offers = [];
    this.changed("accepted");
    return ok(structuredClone(state.active));
  }
  abandon(): Result<void> {
    const state = this.deps.state();
    if (!state.active || state.active.status === "claimed") return err("INVALID_ARGUMENT", "There is no active hunt to abandon.");
    state.lastTargetId = state.active.offer.targetId;
    state.active = null;
    this.changed("abandoned");
    this.refreshOffers();
    return ok(undefined);
  }
  claim(): Result<number> {
    const state = this.deps.state();
    const active = state.active;
    if (!active || active.status !== "ready") return err("INVALID_ARGUMENT", "There is no hunt reward ready to claim.");
    // Mark before XP emits level events, so reentrant claims cannot grant the same reward twice.
    active.status = "claimed";
    state.completedCount += 1;
    state.lastTargetId = active.offer.targetId;
    this.deps.awardXp(active.offer.rewardSkill, active.offer.rewardXp);
    this.changed("claimed");
    this.refreshOffers();
    return ok(active.offer.rewardXp);
  }
  private onEvent(event: GameEvent): void {
    const state = this.deps.state();
    const active = state.active;
    const data = event.data;
    if (event.type !== "combat.ended" || data.reason !== "killed" || !active || active.status !== "active"
      || data.creditedPlayerId !== this.deps.playerId() || !integer(data.killSerial)
      || data.killSerial <= active.lastCreditedSerial || data.killSerial > state.killSerial
      || typeof data.enemyId !== "string") return;
    const entity = this.deps.entity(data.enemyId);
    const enemyDefId = entity?.meta?.enemyDefId;
    if (!entity || entity.archetype !== "enemy" || entity.state !== "dead" || entity.regionId !== active.offer.regionId
      || typeof enemyDefId !== "string" || !active.offer.enemyDefIds.some(id => huntEnemyDefMatches(id, enemyDefId))) return;
    active.lastCreditedSerial = data.killSerial;
    active.kills += 1;
    if (active.kills === active.offer.requiredKills) active.status = "ready";
    this.changed(active.status === "ready" ? "ready" : "progress");
  }
  private changed(action: string): void {
    this.deps.markDirty();
    const state = this.deps.state();
    this.deps.events.emit("quest.updated", { source: "hunt", action, hunt: state.active ? structuredClone(state.active) : null,
      completedCount: state.completedCount });
  }
}
