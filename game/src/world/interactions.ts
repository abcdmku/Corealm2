/**
 * The interaction dispatcher: one place where every `interact(entityId, interaction)` is validated
 * before anything happens.
 *
 * This satisfies `SystemHooks.interactions` in `api/gameApi.ts`. Round 1 fully handles `inspect`
 * and validates range, requirements, and state for everything else; rounds 2, 4, and 5 attach
 * gathering, combat, and dialogue through `registerHandler` without editing this file.
 *
 * Two rules it exists to enforce:
 *
 * 1. Nothing throws across the boundary. Every failure is a `Result` carrying a `GameErrorCode`,
 *    because the agent surface and the UI both read the code and neither can catch an exception.
 * 2. Validation happens in the same order for a human click and a WebMCP call, so PRD F11 (run the
 *    same action both ways and diff state) can never diverge on an error path.
 *
 * Order is deliberate: existence, then "is this verb even on this thing", then requirements, then
 * range, then state. Requirements before range means a player 60 m from a Kaldite seam at Mining 1
 * is told what they actually need rather than being sent on a walk to be refused at the end.
 */
import type {
  EntityId, GameErrorCode, InteractionId, Result, SemanticEntity, SkillId, Vec3,
} from "../contracts.js";
import { err, ok } from "../contracts.js";
import { SKILLS } from "../content/skills.js";
import { INTERACT_RANGE, SPELL_RANGE } from "../app/config.js";
import { distanceXZ } from "../core/math.js";

export interface InteractionContext {
  entity: SemanticEntity;
  interaction: InteractionId;
  playerPosition: Vec3;
  skills: Record<SkillId, number>;
  /** Horizontal metres from the player to the working position, already computed. */
  distance: number;
}

export type InteractionHandler = (context: InteractionContext) => Result<{ started: string }>;

export interface InteractionDeps {
  get(id: EntityId): SemanticEntity | undefined;
  playerPosition(): Vec3;
  skillLevels(): Record<SkillId, number>;
}

/**
 * Range per verb: how close the player is walked before the handler runs.
 *
 * `attack` reaches SPELL_RANGE, not melee range, and that is the whole of "magic is a ranged
 * attack". This layer cannot see what the player is holding — `world/` never imports content or
 * equipment — so it gates on the FURTHEST either weapon can reach and lets `systems/combat.ts`,
 * which can see the main hand, decide from there. A caster who clicks a distant target walks only
 * until the target is inside SPELL_RANGE and opens fire from there; a swordsman keeps walking,
 * closed the rest of the way by `CombatSystem.pursue`, which applies MELEE_RANGE at the swing.
 * Gating this at 2.4 m instead marched every mage into melee before their first cast, which is the
 * opposite of what a fifteen-metre spell is for.
 *
 * The dispatcher gates *starting* an action, not landing a hit; the tighter range still applies
 * where it belongs.
 */
const DEFAULT_RANGES: Partial<Record<InteractionId, number>> = {
  cast: SPELL_RANGE,
  attack: Math.max(SPELL_RANGE, INTERACT_RANGE),
};

/** Gathering verbs, so a depleted node is refused with DEPLETED rather than a vague failure. */
const GATHER_INTERACTIONS: ReadonlySet<InteractionId> = new Set<InteractionId>([
  "mine", "chop", "fish",
]);

const COMBAT_INTERACTIONS: ReadonlySet<InteractionId> = new Set<InteractionId>(["attack", "cast"]);

export class InteractionDispatcher {
  private readonly handlers = new Map<InteractionId, InteractionHandler>();
  private readonly ranges = new Map<InteractionId, number>();

  constructor(private readonly deps: InteractionDeps) {
    for (const [interaction, range] of Object.entries(DEFAULT_RANGES) as [InteractionId, number][]) {
      this.ranges.set(interaction, range);
    }
    // `inspect` is the one verb this file owns outright. Registering it through the same table as
    // everything else means there is exactly one dispatch path, not a special case plus a table.
    this.handlers.set("inspect", (context) => ok({ started: describe(context.entity) }));
  }

  /**
   * Later rounds attach here. Registering a handler twice replaces it, which is what a hot reload
   * and a test harness both want.
   */
  registerHandler(interaction: InteractionId, handler: InteractionHandler): void {
    this.handlers.set(interaction, handler);
  }

  hasHandler(interaction: InteractionId): boolean {
    return this.handlers.has(interaction);
  }

  /** Overrides the range for one verb. Round 4 uses this if combat wants a longer leash. */
  setRange(interaction: InteractionId, metres: number): void {
    this.ranges.set(interaction, metres);
  }

  rangeFor(interaction: InteractionId, entityId?: EntityId): number {
    const entity = entityId ? this.deps.get(entityId) : undefined;
    // A mining stance is already outside the rock. Stop at that stance before swinging,
    // rather than treating it as another rock centre and stopping two metres short.
    if (interaction === "mine" && entity?.archetype === "ore" && entity.interactionPosition) return 0.45;
    if (interaction === "enter" && entity?.archetype === "portal" && entity.interactionPosition) return 0.45;
    return this.ranges.get(interaction) ?? INTERACT_RANGE;
  }

  run(entityId: EntityId, interaction: InteractionId): Result<{ started: string }> {
    const entity = this.deps.get(entityId);
    if (!entity) return err("NOT_FOUND", `No entity with id ${entityId}`, entityId);

    if (!entity.interactions.includes(interaction)) {
      return err(
        "INVALID_ARGUMENT",
        `${entity.name} has no "${interaction}" interaction. Available: ${entity.interactions.join(", ")}`,
        entityId,
      );
    }

    const skills = this.deps.skillLevels();

    const unmet = unmetRequirement(entity, skills);
    if (unmet) return err("REQUIREMENTS_NOT_MET", unmet, entityId);

    const playerPosition = this.deps.playerPosition();
    const distance = distanceXZ(playerPosition, entity.interactionPosition ?? entity.position);
    const range = this.rangeFor(interaction, entityId);
    if (distance > range) {
      return err(
        "OUT_OF_RANGE",
        `${entity.name} is ${distance.toFixed(1)} m away; you need to be within ${range.toFixed(1)} m`,
        entityId,
      );
    }

    const stateProblem = checkState(entity, interaction);
    if (stateProblem) return err(stateProblem.code, stateProblem.message, entityId);

    const handler = this.handlers.get(interaction);
    if (!handler) {
      return err(
        "UNAVAILABLE",
        `"${interaction}" is not wired up yet`,
        entityId,
      );
    }

    return handler({ entity, interaction, playerPosition, skills, distance });
  }
}

// ------------------------------------------------------------- validation

/** The first unmet skill requirement, as the same plain text the observation layer returns. */
function unmetRequirement(
  entity: SemanticEntity,
  skills: Record<SkillId, number>,
): string | undefined {
  const requirements = entity.requirements;
  if (!requirements) return undefined;
  const missing: string[] = [];
  for (const key of Object.keys(requirements) as SkillId[]) {
    const needed = requirements[key];
    if (needed === undefined) continue;
    if ((skills[key] ?? 1) < needed) missing.push(`${SKILLS[key].name} ${needed}`);
  }
  if (missing.length === 0) return undefined;
  return `Requires ${missing.join(" and ")}`;
}

interface StateProblem {
  code: GameErrorCode;
  message: string;
}

/**
 * Archetype-specific state gates. Everything here is a *refusal to start*, not a rule about how
 * the action resolves - those live in the systems that own each verb.
 */
function checkState(entity: SemanticEntity, interaction: InteractionId): StateProblem | undefined {
  if (interaction === "inspect") return undefined;

  if (GATHER_INTERACTIONS.has(interaction)) {
    const resource = entity.resource;
    if (entity.state === "depleted" || (resource && resource.remaining <= 0)) {
      const seconds = resource?.respawnSeconds ?? 0;
      return {
        code: "DEPLETED",
        message: `${entity.name} is worked out. It comes back in about ${seconds} s.`,
      };
    }
  }

  if (COMBAT_INTERACTIONS.has(interaction)) {
    if (entity.state === "dead") {
      return { code: "INVALID_ARGUMENT", message: `${entity.name} is already dead.` };
    }
    if (entity.archetype !== "enemy" && entity.archetype !== "boss") {
      return { code: "INVALID_ARGUMENT", message: `${entity.name} is not something you can attack.` };
    }
  }

  if (interaction === "open" && (entity.state === "locked" || entity.state === "sealed")) {
    const reason = entity.meta?.lockedReason;
    return {
      code: "INVALID_ARGUMENT",
      message: typeof reason === "string" ? reason : `${entity.name} will not open.`,
    };
  }

  if ((interaction === "climb" || interaction === "vault") && entity.archetype !== "obstacle") {
    return { code: "INVALID_ARGUMENT", message: `${entity.name} is not an obstacle.` };
  }

  return undefined;
}

// ---------------------------------------------------------------- inspect

/**
 * One line of plain text describing an entity. This is what an agent gets back from `inspect`, and
 * what the UI puts in the examine bar, so it has to carry the facts a decision needs: what it is,
 * what state it is in, what it gives, and what it costs to use.
 */
export function describe(entity: SemanticEntity): string {
  const parts: string[] = [entity.name];
  parts.push(entity.state);

  const resource = entity.resource;
  if (resource) {
    parts.push(
      resource.remaining > 0
        ? `${resource.remaining}/${resource.maxYields} yields left`
        : `worked out, back in ${resource.respawnSeconds} s`,
    );
  }

  const combat = entity.combat;
  if (combat) parts.push(`level ${combat.level}, ${combat.health}/${combat.maxHealth} hp`);

  const station = entity.station;
  if (station) parts.push(`${SKILLS[station.skill].name} station`);

  const obstacle = entity.obstacle;
  if (obstacle) {
    parts.push(`saves ${obstacle.savesMeters} m for ${(obstacle.durationMs / 1000).toFixed(1)} s`);
  }

  const requirements = entity.requirements;
  if (requirements) {
    const listed: string[] = [];
    for (const key of Object.keys(requirements) as SkillId[]) {
      const needed = requirements[key];
      if (needed !== undefined) listed.push(`${SKILLS[key].name} ${needed}`);
    }
    if (listed.length > 0) parts.push(`requires ${listed.join(", ")}`);
  }

  const blurb = entity.meta?.blurb;
  if (typeof blurb === "string") parts.push(blurb);

  return parts.join(". ");
}
