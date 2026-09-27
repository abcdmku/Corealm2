import { creatureBodies, type CreatureBody, type CreatureDefinitionRow, type CreatureLook } from "../../../model/creatureArt.js";
import type { ArtSummary, ArtVerdict } from "../../../model/artReview.js";
import type { CreatureData } from "../../creatures/shared.js";

/*
  The creature art review's list: one entry per body (a model), carrying every definition that
  wears it. Names are shared by several bodies and several definitions, so the id is shown wherever
  a name repeats; nothing is ever merged by name.
*/

export interface BodyEntry {
  body: CreatureBody;
  assetId: string;
  /** The first base definition's name, else the lowest-level variant's. */
  name: string;
  /** True when another body carries the same name. */
  nameRepeats: boolean;
  /** The definition whose picture stands for the body: the first base, else the lowest-level variant. */
  leadId: string;
  level: number;
  regions: ReadonlySet<string>;
  haystack: string;
}

export type VerdictFilter = "all" | "unreviewed" | ArtVerdict;
export type SortBy = "level" | "name" | "verdict";
export interface BodyFilters { search: string; verdict: VerdictFilter; region: string; sort: SortBy }
export const DEFAULT_FILTERS: BodyFilters = { search: "", verdict: "all", region: "", sort: "level" };

export function bodyEntries(data: CreatureData): { entries: BodyEntry[]; lookNameRepeats: ReadonlySet<string> } {
  const bodies = creatureBodies(data.creatures as unknown as CreatureDefinitionRow[]);
  const lookNames = new Map<string, number>();
  for (const body of bodies) for (const look of body.looks) lookNames.set(look.name, (lookNames.get(look.name) ?? 0) + 1);
  const drafts = bodies.map(body => {
    const lead = body.looks.find(look => !look.baseId) ?? body.looks[0]!;
    const regions = new Set(body.looks.map(look => look.regionId).filter((id): id is string => Boolean(id)));
    const haystack = [body.assetId, ...body.families, ...body.looks.flatMap(look => [look.name, look.creatureId, look.family ?? ""])].join(" ").toLowerCase();
    return { body, assetId: body.assetId, name: lead.name, nameRepeats: false, leadId: lead.creatureId, level: body.looks[0]!.level, regions, haystack };
  });
  const bodyNames = new Map<string, number>();
  for (const entry of drafts) bodyNames.set(entry.name, (bodyNames.get(entry.name) ?? 0) + 1);
  for (const entry of drafts) entry.nameRepeats = (bodyNames.get(entry.name) ?? 0) > 1;
  return { entries: drafts, lookNameRepeats: new Set([...lookNames].filter(([, count]) => count > 1).map(([name]) => name)) };
}

const VERDICT_ORDER: Readonly<Record<string, number>> = { replace: 0, polish: 1, unreviewed: 2, approved: 3 };

export function filterBodies(entries: readonly BodyEntry[], filters: BodyFilters, verdicts: ReadonlyMap<string, ArtSummary>): BodyEntry[] {
  const needle = filters.search.trim().toLowerCase();
  const verdictOf = (entry: BodyEntry) => verdicts.get(entry.assetId)?.verdict ?? "unreviewed";
  const shown = entries.filter(entry => {
    if (needle && !entry.haystack.includes(needle)) return false;
    if (filters.region && !entry.regions.has(filters.region)) return false;
    if (filters.verdict !== "all" && verdictOf(entry) !== filters.verdict) return false;
    return true;
  });
  const byName = (a: BodyEntry, b: BodyEntry) => a.name.localeCompare(b.name) || a.assetId.localeCompare(b.assetId);
  const byLevel = (a: BodyEntry, b: BodyEntry) => a.level - b.level || byName(a, b);
  if (filters.sort === "name") return shown.sort(byName);
  if (filters.sort === "verdict") return shown.sort((a, b) => VERDICT_ORDER[verdictOf(a)]! - VERDICT_ORDER[verdictOf(b)]! || byLevel(a, b));
  return shown.sort(byLevel);
}

/** A definition's label: its name, or its id when the name is shared. */
export const lookLabel = (look: CreatureLook, repeats: ReadonlySet<string>): string => repeats.has(look.name) ? `${look.name} · ${look.creatureId}` : look.name;
