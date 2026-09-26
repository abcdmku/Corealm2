import type { SemanticEntity, Vec3 } from '../contracts.js';
import type { HabitatDef } from '../content/worldHabitats.js';
import { hashId } from './habitatMovement.js';
import { isFairyRegion } from '../contracts.js';

export interface MobSpawnSpacingPorts {
  underground(regionId: string): boolean;
  /** Returns the actual dry, walkable, body-clear receiving floor, or null. */
  place(entity: SemanticEntity, x: number, z: number, radius: number): Vec3 | null;
}

/** Final placement applies to every source, including authored, coastal and regional packs.
 * All actors in a realm share occupancy; neighbouring groups cannot fill each other's gaps.
 * IDs, counts, stats and loot are retained. No cramped-layout fallback is permitted.
 */
export function spreadMobSpawns(entities: readonly SemanticEntity[], habitats: readonly HabitatDef[],
  ports: MobSpawnSpacingPorts, settled: readonly SemanticEntity[] = []): HabitatDef[] {
  const sources = new Map(habitats.map(habitat => [habitat.groupId, habitat]));
  const mobs = entities.filter(entity => entity.archetype === 'enemy' || entity.archetype === 'boss');
  const groups = new Map<string, SemanticEntity[]>();
  for (const entity of mobs) {
    const key = String(entity.meta?.groupId ?? entity.id);
    const group = groups.get(key) ?? [];
    group.push(entity); groups.set(key, group);
  }
  type Occupant = { position: Vec3; radius: number; underground: boolean; extra: number; roam: number; groupId?: string };
  const cells = new Map<string, Occupant[]>();
  const largestRadius = Math.max(.5, ...[...mobs, ...settled].map(entity => entity.combat?.bodyRadius ?? .5));
  const reserve = (entry: Occupant): void => {
    const key = `${entry.underground}:${Math.floor(entry.position[0] / 32)}:${Math.floor(entry.position[2] / 32)}`;
    const cell = cells.get(key) ?? [];
    cell.push(entry); cells.set(key, cell);
  };
  // Singular encounter actors keep their location and reserve space before ordinary residents.
  for (const entity of mobs.filter(entity => entity.archetype === 'boss')) {
    reserve({ position: entity.position, radius: entity.combat?.bodyRadius ?? .5,
      underground: ports.underground(entity.regionId), extra: 0, roam: 0 });
  }
  // A live rebuild places a few groups among residents that keep their spawn. Those hold their ground first.
  for (const entity of settled) {
    const x = entity.meta?.spawnX, z = entity.meta?.spawnZ;
    reserve({ position: typeof x === 'number' && typeof z === 'number' ? [x, entity.position[1], z] : entity.position, radius: entity.combat?.bodyRadius ?? .5,
      underground: ports.underground(entity.regionId), extra: 0, roam: sources.get(String(entity.meta?.groupId))?.roamRadius ?? 5.2,
      groupId: String(entity.meta?.groupId ?? entity.id) });
  }
  const result: HabitatDef[] = [];
  const orderedGroups = [...groups].sort((a, b) =>
    Math.max(...b[1].map(entity => entity.combat?.bodyRadius ?? .5))
      - Math.max(...a[1].map(entity => entity.combat?.bodyRadius ?? .5)) || a[0].localeCompare(b[0]));
  for (const [groupId, members] of orderedGroups) {
    const ordinary = members.filter(entity => entity.archetype === 'enemy');
    if (!ordinary.length) continue;
    const source = sources.get(groupId);
    const compact = source?.roamRadius !== undefined && source.roamRadius < 1;
    const enclosed = source && (isFairyRegion(source.regionId) || compact);
    const groupVariation = hashId(`${groupId}:spacing`) / 0xffffffff;
    const activityRadius = { forage: 1.8, graze: 2.6, prowl: 3.8, patrol: 4.5 }[source?.activity ?? 'patrol'];
    const roamRadius = source?.roamRadius ?? (ports.underground(ordinary[0]!.regionId)
      ? .75 + groupVariation * .4 : source?.boundary === 'playable-coast'
        // Shoreline packs have narrow dry receiving ground, unlike inland patrol clearings.
        ? 1.25 + groupVariation * .5 : source && isFairyRegion(source.regionId)
        ? 1.5 : activityRadius * (.85 + groupVariation * .3));
    // Wilderness formations reserve room for their accepted body families. The
    // final floor search must not collapse them back to the generic minimum.
    let authoredSeparation = 0;
    if (source?.regionId === 'wilderness' && source.anchors && source.anchors.length > 1) {
      authoredSeparation = Infinity;
      for (let i = 0; i < source.anchors.length; i++) for (let j = i + 1; j < source.anchors.length; j++) {
        const a = source.anchors[i]!, b = source.anchors[j]!;
        authoredSeparation = Math.min(authoredSeparation, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
    }
    const centre = source?.centre ?? [ordinary.reduce((sum, e) => sum + e.position[0], 0) / ordinary.length,
      ordinary.reduce((sum, e) => sum + e.position[2], 0) / ordinary.length] as const;
    const anchors: [number, number][] = [];
    for (const entity of ordinary) {
      const underground = ports.underground(entity.regionId);
      const radius = entity.combat?.bodyRadius ?? .5;
      const minimum = Math.max(compact ? 3 : underground ? 5 : 6, authoredSeparation);
      // Leave a running lane even when both residents wander toward each other.
      const lane = compact ? .5 : 2;
      const phase = (hashId(entity.id) % 360) * Math.PI / 180;
      const desired = [entity.position[0], entity.position[2]];
      // Independent stable samples break repeated authored sockets and equal rings.
      // Variation is local to each resident, so changing another pack does not reroll it.
      const sample = (key: string): number => hashId(`${entity.id}:placement:${key}`) / 0xffffffff;
      const extra = (compact ? .15 : underground ? 1 : 5) * groupVariation * sample('clearance');
      let destination: Vec3 | null = null;
      const tryPoint = (x: number, z: number): void => {
        if (destination) return;
        if (enclosed && Math.hypot(x - source.centre[0], z - source.centre[1])
          + radius + roamRadius > source.radius) return;
        const reach = Math.max(6, minimum, radius + largestRadius + roamRadius + 5.2 + 2) + 5;
        for (let gx = Math.floor((x - reach) / 32); gx <= Math.floor((x + reach) / 32); gx++) {
          for (let gz = Math.floor((z - reach) / 32); gz <= Math.floor((z + reach) / 32); gz++) {
            if (cells.get(`${underground}:${gx}:${gz}`)?.some(other =>
              Math.hypot(x - other.position[0], z - other.position[2]) < Math.max(
                compact && other.groupId !== groupId ? 6 : minimum,
                radius + other.radius + roamRadius + other.roam
                  + (compact && other.groupId !== groupId ? 2 : lane))
                + Math.max(extra, other.extra))) return;
          }
        }
        destination = ports.place(entity, x, z, radius);
      };
      const offset = (compact ? .3 : underground ? 1 : 4) * Math.sqrt(sample('offset'));
      const direction = sample('direction') * Math.PI * 2;
      tryPoint(desired[0]! + Math.cos(direction) * offset, desired[1]! + Math.sin(direction) * offset);
      tryPoint(desired[0]!, desired[1]!);
      // Search nearby receiving floor rather than snapping many roots to one navmesh edge.
      for (let ring = 0; ring <= (underground ? 45 : 140) && !destination; ring++) {
        const distance = ring * 2;
        const count = Math.max(1, Math.ceil(Math.PI * 2 * distance / 2));
        for (let index = 0; index < count && !destination; index++) {
          const angle = phase + (index + sample(`angle:${ring}:${index}`)) / count * Math.PI * 2;
          const scatteredDistance = distance + sample(`radius:${ring}:${index}`) * 2;
          tryPoint(centre[0] + Math.cos(angle) * scatteredDistance, centre[1] + Math.sin(angle) * scatteredDistance);
        }
      }
      if (!destination) throw new Error(`No spaced, walkable spawn for ${entity.id} at ${centre.join(',')} with body radius ${radius}`);
      const position = destination as Vec3;
      entity.position = position;
      entity.meta = { ...entity.meta, groupId, habitatId: source?.id ?? `${groupId}_spaced`,
        spawnX: position[0], spawnZ: position[2] };
      anchors.push([position[0], position[2]]);
      reserve({ position, radius, underground, extra, roam: roamRadius, groupId });
    }
    result.push({ ...source, id: source?.id ?? `${groupId}_spaced`, groupId,
      regionId: ordinary[0]!.regionId, centre,
      radius: enclosed ? source.radius : Math.max(...anchors.map(point => Math.hypot(point[0] - centre[0], point[1] - centre[1]))) + 8,
      anchors, activity: source?.activity ?? 'patrol', dressing: source?.dressing ?? [],
      roamRadius });
  }
  return result;
}
