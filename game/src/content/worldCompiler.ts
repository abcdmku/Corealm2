import type { EnemyDef } from './index.js';
import type { EnemyGroupDef, Spot } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';
import type { EncounterDefinition, WorldPlacement } from './schema/encounters.js';
import type { SchemaIssue } from './schema/core.js';

export interface WorldCreature { id: string; assetId: string; scale: number; stats: EnemyDef; bodyRadius: number }
export interface WorldRegionBounds { id: string; bounds: { min: Spot; max: Spot } }
export interface WorldCompilerInput {
  encounters: readonly EncounterDefinition[];
  placements: readonly WorldPlacement[];
  creatures: ReadonlyMap<string, WorldCreature>;
  regions: readonly WorldRegionBounds[];
  resolveCreature?: (id: string, level: number) => WorldCreature | undefined;
  /** Retired creatures still resolve, so their members are skipped here instead of failing as unknown. */
  retired?: ReadonlySet<string>;
}
/** Formation offsets are authored relative to the centre, so dragging never leaves residents behind. */
export function placementAnchors(placement: WorldPlacement): [number, number][] {
  const { count, centre, formation } = placement;
  const adjustments = new Map(placement.anchorAdjustments?.map(row => [row.index, row.offset]));
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const c = Math.cos(formation.rotation), s = Math.sin(formation.rotation);
  return Array.from({ length: count }, (_, index) => {
    let x = 0, z = 0;
    if (formation.kind === 'ring' && count > 1) {
      const r = formation.spacing / (2 * Math.sin(Math.PI / count));
      x = Math.cos(index * Math.PI * 2 / count) * r;
      z = Math.sin(index * Math.PI * 2 / count) * r;
    } else if (formation.kind === 'grid') {
      const row = Math.floor(index / columns);
      const inRow = Math.min(columns, count - row * columns);
      x = (index % columns - (inRow - 1) / 2) * formation.spacing;
      z = (row - (rows - 1) / 2) * formation.spacing;
    }
    const offset = adjustments.get(index);
    return [centre[0] + (offset?.[0] ?? (x * c - z * s)), centre[1] + (offset?.[1] ?? (x * s + z * c))];
  });
}

/** Pure compilation. Terrain and navigation samplers validate the receiving floor during the world bake. */
export function compileWorld(input: WorldCompilerInput) {
  const diagnostics: SchemaIssue[] = [];
  const groupsByRegion = new Map<string, EnemyGroupDef[]>();
  const habitats: HabitatDef[] = [];
  const creatureByGroup = new Map<string, WorldCreature>();
  const encounters = new Map<string, EncounterDefinition>();
  const regions = new Map(input.regions.map(row => [row.id, row.bounds]));
  const seen = new Set<string>();
  const issue = (path: string, message: string) => diagnostics.push({ path, message, severity: 'error' });
  for (const encounter of input.encounters) {
    if (encounters.has(encounter.id)) issue(`encounters.${encounter.id}`, 'Duplicate encounter ID');
    encounters.set(encounter.id, encounter);
    for (const member of encounter.members) if (!input.creatures.has(member.creatureId))
      issue(`encounters.${encounter.id}.members`, `Unknown creature ${member.creatureId}`);
  }
  for (const placement of input.placements) {
    const path = `placements.${placement.id}`;
    if (seen.has(placement.id)) { issue(path, 'Duplicate placement ID'); continue; }
    seen.add(placement.id);
    const encounter = encounters.get(placement.encounterId);
    const bounds = regions.get(placement.regionId);
    if (!encounter) { issue(`${path}.encounterId`, `Unknown encounter ${placement.encounterId}`); continue; }
    if (!bounds) { issue(`${path}.regionId`, `Unknown region ${placement.regionId}`); continue; }
    if (placement.formation.kind === 'authored' && placement.anchorAdjustments?.length !== placement.count) {
      issue(`${path}.anchorAdjustments`, 'Authored formations need one anchor per resident'); continue;
    }
    const anchors = placementAnchors(placement);
    const totalWeight = encounter.members.reduce((sum, member) => sum + member.weight, 0);
    const assigned = encounter.members.map(() => [] as number[]);
    for (let index = 0; index < placement.count; index++) {
      const target = (index + .5) * totalWeight / placement.count;
      let sum = 0, memberIndex = encounter.members.length - 1;
      for (let m = 0; m < encounter.members.length; m++) {
        sum += encounter.members[m]!.weight;
        if (target <= sum) { memberIndex = m; break; }
      }
      assigned[memberIndex]!.push(index);
    }
    encounter.members.forEach((member, memberIndex) => {
      const indices = assigned[memberIndex]!;
      if (!indices.length || input.retired?.has(member.creatureId)) return;
      const source = placement.level !== undefined && input.resolveCreature
        ? input.resolveCreature(member.creatureId, placement.level) : input.creatures.get(member.creatureId);
      if (!source) return;
      const scaleMultiplier = placement.scaleMultiplier ?? 1;
      const bodyRadius = source.bodyRadius * scaleMultiplier * (placement.rank === 'boss' ? 1.6 : placement.rank === 'miniboss' ? 1.3 : 1);
      const selected = indices.map(index => anchors[index]!);
      for (let a = 0; a < selected.length; a++) for (let b = a + 1; b < selected.length; b++) {
        if (Math.hypot(selected[a]![0] - selected[b]![0], selected[a]![1] - selected[b]![1]) + .01 < bodyRadius * 2)
          issue(`${path}.anchors[${b}]`, `Creature overlaps resident ${a + 1}`);
      }
      for (const [index, anchor] of selected.entries()) {
        if (!anchor.every(Number.isFinite)) issue(`${path}.anchors[${index}]`, 'Anchor must be finite');
        if (Math.hypot(anchor[0] - placement.centre[0], anchor[1] - placement.centre[1]) + bodyRadius > placement.radius + .01)
          issue(`${path}.anchors[${index}]`, 'Creature body exceeds placement radius');
        if (!placement.boundary && (anchor[0] < bounds.min[0] || anchor[0] > bounds.max[0]
          || anchor[1] < bounds.min[1] || anchor[1] > bounds.max[1])) issue(`${path}.anchors[${index}]`, 'Anchor falls outside region');
      }
      const groupId = encounter.members.length === 1 ? placement.id : `${placement.id}_${memberIndex + 1}`;
      const group: EnemyGroupDef = { id: groupId, family: source.stats.family, name: source.stats.name,
        tier: source.stats.tier, assetId: source.assetId, scale: source.scale * scaleMultiplier,
        centre: placement.centre, count: indices.length, countPolicy: 'fixed', radius: placement.radius,
        ...(placement.firstActorUsesPlacementId ? { legacyCount: 1 } : {}),
        ...(placement.rank === 'boss' ? { boss: true } : {}), ...(placement.rank === 'miniboss' ? { miniBoss: true } : {}) };
      const groups = groupsByRegion.get(placement.regionId) ?? [];
      groups.push(group); groupsByRegion.set(placement.regionId, groups);
      creatureByGroup.set(groupId, source);
      // Bosses own their encounter origin; roaming habitat systems apply to ordinary residents.
      if (!placement.rank) habitats.push({ id: encounter.members.length === 1 ? placement.habitatId ?? `${groupId}_habitat` : `${groupId}_habitat`,
        groupId, regionId: placement.regionId as HabitatDef['regionId'], centre: placement.centre,
        radius: placement.radius, anchors: selected, activity: encounter.activity,
        dressing: memberIndex === 0 ? placement.dressing : [],
        ...(placement.roamRadius === undefined ? {} : { roamRadius: placement.roamRadius }),
        ...(placement.boundary ? { boundary: placement.boundary } : {}) });
    });
  }
  return { groupsByRegion, habitats, creatureByGroup, diagnostics };
}
