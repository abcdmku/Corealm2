/**
 * Creature art as a reviewer sees it: which model a definition wears, at what scale, and which
 * definitions share one body. A variant without its own presentation wears its base's.
 */

export interface CreaturePresentationRow {
  id?: string;
  assetId?: string;
  scale?: number;
  regionId?: string;
  description?: string;
  kind?: string;
  acceptance?: string;
  source?: { author?: string; license?: string; generator?: string };
}

export interface CreatureDefinitionRow {
  id: string;
  name?: string;
  family?: string;
  availability?: string;
  level?: number;
  profileId?: string;
  baseId?: string;
  retired?: boolean;
  presentation?: CreaturePresentationRow;
}

/** One definition's resolved look. */
export interface CreatureLook {
  creatureId: string;
  /** The display name, or the id when the definition has none. */
  name: string;
  family: string | undefined;
  level: number;
  availability: string | undefined;
  baseId: string | undefined;
  /** Undefined for the few definitions that have no model at all. */
  assetId: string | undefined;
  scale: number;
  regionId: string | undefined;
  /** True when the presentation came from the base definition. */
  inherited: boolean;
  presentation: CreaturePresentationRow | undefined;
}

/** One model and every definition that wears it, lowest level first. */
export interface CreatureBody {
  assetId: string;
  looks: CreatureLook[];
  families: string[];
}

export function creatureLook(definition: CreatureDefinitionRow, byId: ReadonlyMap<string, CreatureDefinitionRow>): CreatureLook {
  const base = definition.baseId ? byId.get(definition.baseId) : undefined;
  const own = definition.presentation;
  const presentation = own ?? base?.presentation;
  return {
    creatureId: definition.id,
    name: definition.name ?? base?.name ?? definition.id,
    family: definition.family ?? base?.family,
    level: definition.level ?? base?.level ?? 0,
    availability: definition.availability ?? base?.availability,
    baseId: definition.baseId,
    assetId: presentation?.assetId,
    scale: presentation?.scale ?? 1,
    regionId: presentation?.regionId,
    inherited: !own && Boolean(base?.presentation),
    presentation,
  };
}

export function creatureLooks(definitions: readonly CreatureDefinitionRow[]): CreatureLook[] {
  const byId = new Map(definitions.map(row => [row.id, row]));
  return definitions.filter(row => !row.retired).map(row => creatureLook(row, byId));
}

/** Group by model. Definitions with no model are left out; list them with `creatureLooks`. */
export function creatureBodies(definitions: readonly CreatureDefinitionRow[]): CreatureBody[] {
  const bodies = new Map<string, CreatureBody>();
  for (const look of creatureLooks(definitions)) {
    if (!look.assetId) continue;
    let body = bodies.get(look.assetId);
    if (!body) { body = { assetId: look.assetId, looks: [], families: [] }; bodies.set(look.assetId, body); }
    body.looks.push(look);
    if (look.family && !body.families.includes(look.family)) body.families.push(look.family);
  }
  for (const body of bodies.values()) body.looks.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name) || a.creatureId.localeCompare(b.creatureId));
  return [...bodies.values()].sort((a, b) => a.looks[0]!.level - b.looks[0]!.level || a.assetId.localeCompare(b.assetId));
}
