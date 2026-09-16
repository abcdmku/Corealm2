import type { ReactNode } from "react";
import type { SkillId, SpellElement } from "../../../game/src/contracts.js";
import { SKILLS } from "../../../game/src/content/skills.js";
import { runeIconSvg } from "../../../game/src/ui/runeIcons.js";
import { spellIconSvg, type SpellIconSubject } from "../../../game/src/ui/spellIcons.js";
import { cn } from "../lib/utils.js";

/*
  The game's own marks for its vocabulary, and nothing invented: a skill is its colour (the one the
  skills panel and the floating XP number use), an element is its spell motif, a rune is its carved
  stone. A word the game draws no mark for gets none.
*/

const ELEMENTS: ReadonlySet<string> = new Set(["wind", "water", "earth", "fire"]);

export function SkillSwatch({ skill, className }: { skill: string; className?: string }) {
  const colour = SKILLS[skill as SkillId]?.colour;
  return colour ? <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", className)} style={{ background: colour }} /> : null;
}

export function ElementMark({ element, className }: { element: string; className?: string }) {
  if (!ELEMENTS.has(element)) return null;
  const subject = { id: element, element: element as SpellElement, rung: "lash", rank: 0 } as unknown as SpellIconSubject;
  return <span aria-hidden className={cn("inline-block size-4 shrink-0 [&_svg]:block [&_svg]:size-full", className)} dangerouslySetInnerHTML={{ __html: spellIconSvg(subject) }} />;
}

export function RuneMark({ itemId, className }: { itemId: string; className?: string }) {
  const svg = runeIconSvg(itemId);
  return svg ? <span aria-hidden className={cn("inline-block size-4 shrink-0 [&_svg]:block [&_svg]:size-full", className)} dangerouslySetInnerHTML={{ __html: svg }} /> : null;
}

/** The game's mark for a stored value, when it has one. */
export function gameArt(value: string): ReactNode | undefined {
  if (value in SKILLS) return <SkillSwatch skill={value} />;
  if (ELEMENTS.has(value)) return <ElementMark element={value} />;
  if (runeIconSvg(value)) return <RuneMark itemId={value} />;
  return undefined;
}
