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

/* ---------- Authoring looks ---------- */

type Creature = CreatureData["creatures"][number];
export type Presentation = NonNullable<Creature["presentation"]>;
export type Variation = NonNullable<Presentation["variation"]>;

/** A definition's effective presentation: its own, else its base's. */
export const presentationOf = (definition: Creature | undefined, base: Creature | undefined): Presentation | undefined => definition?.presentation ?? base?.presentation;

/**
 * Change presentation keys on a definition (`undefined` deletes one). A variant that inherits its
 * base's presentation takes a copy under its own id first; a copy that ends up equal to the base's
 * is dropped again, so the variant goes back to inheriting.
 */
export function withPresentation(current: Creature, base: Creature | undefined, patch: Readonly<Record<string, unknown>>): Creature {
  const seed = current.presentation ?? base?.presentation;
  if (!seed) return current;
  const next = { ...structuredClone(seed), ...(current.presentation ? {} : { id: current.id }) } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) { if (value === undefined) delete next[key]; else next[key] = value; }
  if (current.baseId && base?.presentation && JSON.stringify({ ...next, id: base.presentation.id }) === JSON.stringify(base.presentation)) {
    const { presentation: _dropped, ...inherits } = current;
    return inherits as Creature;
  }
  return { ...current, presentation: next as unknown as Presentation };
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
export const isCreatureId = (id: string): boolean => ID_PATTERN.test(id);

/** `<name>_l<level>`, made unique against `known` with a numeric suffix. */
export function variantIdFor(name: string, level: number | undefined, known: ReadonlySet<string>): string {
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "variant";
  if (!/^[a-z]/.test(slug)) slug = `c_${slug}`;
  const stem = level ? `${slug}_l${level}` : slug;
  let id = stem;
  for (let count = 2; known.has(id); count++) id = `${stem}_${count}`;
  return id;
}

/** The opening prompt for a generated skin, from what the definition says about itself. The author edits it. */
export function skinPrompt({ name, family, region, description }: { name: string; family?: string; region?: string; description?: string }): string {
  const who = [name, family && family.replace(/[_-]+/g, " ") !== name.toLowerCase() ? `(${family.replace(/[_-]+/g, " ")})` : ""].filter(Boolean).join(" ");
  return [
    `Repaint this albedo texture map for ${who}${region ? `, a creature of ${region}` : ""}.`,
    description ? `About it: ${description.trim()}` : "",
    "Keep the UV layout, seams and every painted feature where they are. Layered colours and surface detail (fur, scales, skin, markings), no flat fills, no lighting baked in.",
  ].filter(Boolean).join("\n");
}

/** A range as it reads in the UI: "0.8 to 1.25". */
export const formatRange = (range: readonly [number, number] | undefined, digits = 2): string => range ? `${Number(range[0].toFixed(digits))} to ${Number(range[1].toFixed(digits))}` : "none";
