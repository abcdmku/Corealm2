import type { SemanticEntity, SkillId, SpellElement, SpellRow } from "../contracts.js";
import { SKILLS } from "../content/skills.js";

/** Only actual skill requirements belong in a player-facing level label. */
export function skillRequirementsLabel(requirements?: Partial<Record<SkillId, number>>): string {
  return Object.entries(requirements ?? {})
    .filter((entry): entry is [SkillId, number] => typeof entry[1] === "number")
    .map(([skill, level]) => `${SKILLS[skill].name} ${level}`)
    .join(" · ");
}

export function entityLevelLabel(entity: SemanticEntity): string {
  if (entity.combat) return `Level ${entity.combat.level}`;
  const requirements = entity.obstacle
    ? { ...entity.requirements, agility: entity.obstacle.reqLevel }
    : entity.requirements;
  return skillRequirementsLabel(requirements);
}

export function entityExamineLabel(entity: SemanticEntity): string {
  return `${entity.name} — ${[entityLevelLabel(entity), entity.state].filter(Boolean).join(", ")}.`;
}

/** Element availability comes from its first spell, independently of regional content bands. */
export function spellElementRequirementLabel(
  spells: readonly Pick<SpellRow, "element" | "reqLevel">[],
  element: SpellElement,
): string {
  const levels = spells.filter((spell) => spell.element === element).map((spell) => spell.reqLevel);
  return levels.length > 0 ? `Magic ${Math.min(...levels)}` : "";
}
