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
  ports: MobSpawnSpacingPorts): HabitatDef[] {
  const sources = new Map(habitats.map(habitat => [habitat.groupId, habitat]));
  const mobs = entities.filter(entity => entity.archetype === 'enemy' || entity.archetype === 'boss');
  const groups = new Map<string, SemanticEntity[]>();
  for (const entity of mobs) {
    const key = String(entity.meta?.groupId ?? entity.id);
    const group = groups.get(key) ?? [];
    group.push(entity); groups.set(key, group);
  }
  type Occupant = { position: Vec3; radius: number; underground: boolean; extra: number; groupId?: string };
  const cells = new Map<string, Occupant[]>();
  const largestRadius = Math.max(.5, ...mobs.map(entity => entity.combat?.bodyRadius ?? .5));
  const reserve = (entry: Occupant): void => {
    const key = `${entry.underground}:${Math.floor(entry.position[0] / 32)}:${Math.floor(entry.position[2] / 32)}`;
    const cell = cells.get(key) ?? [];
    cell.push(entry); cells.set(key, cell);
  };
  // Singular encounter actors keep their location and reserve space before ordinary residents.
  for (const entity of mobs.filter(entity => entity.archetype === 'boss')) {
    reserve({ position: entity.position, radius: entity.combat?.bodyRadius ?? .5,
      underground: ports.underground(entity.regionId), extra: 0 });
  }
  const result: HabitatDef[] = [];
  const orderedGroups = [...groups].sort((a, b) =>
    Math.max(...b[1].map(entity => entity.combat?.bodyRadius ?? .5))
      - Math.max(...a[1].map(entity => entity.combat?.bodyRadius ?? .5)) || a[0].localeCompare(b[0]));
  for (const [groupId, members] of orderedGroups) {
    const ordinary = members.filter(entity => entity.archetype === 'enemy');
    if (!ordinary.length) continue;
    const source = sources.get(groupId);
    const clusteredWorms = groupId === 'coldbrace_red_worms';
    const enclosed = source && (isFairyRegion(source.regionId) || clusteredWorms);
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
    const groupVariation = hashId(`${groupId}:spacing`) / 0xffffffff;
    for (const entity of ordinary) {
      const underground = ports.underground(entity.regionId);
      const radius = entity.combat?.bodyRadius ?? .5;
      const minimum = Math.max(clusteredWorms ? 3 : underground ? 5 : 6, authoredSeparation);
      // Leave a running lane even when both residents wander toward each other.
      // Idle patches extend .75 m in caves and 1.5 m outdoors.
      const gap = clusteredWorms ? 1 : underground ? 3.5 : 5;
      const phase = (hashId(entity.id) % 360) * Math.PI / 180;
      const desired = [entity.position[0], entity.position[2]];
      // Independent stable samples break repeated authored sockets and equal rings.
      // Variation is local to each resident, so changing another pack does not reroll it.
      const sample = (key: string): number => hashId(`${entity.id}:placement:${key}`) / 0xffffffff;
      const extra = (clusteredWorms ? .15 : underground ? 1 : 5) * groupVariation * sample('clearance');
      let destination: Vec3 | null = null;
      const tryPoint = (x: number, z: number): void => {
        if (destination) return;
        if (enclosed && Math.hypot(x - source.centre[0], z - source.centre[1])
          + radius + (source.roamRadius ?? 1.5) > source.radius) return;
        const reach = Math.max(clusteredWorms ? 6 : minimum,
          radius + largestRadius + (clusteredWorms ? 5 : gap)) + (underground ? 1 : 5);
        for (let gx = Math.floor((x - reach) / 32); gx <= Math.floor((x + reach) / 32); gx++) {
          for (let gz = Math.floor((z - reach) / 32); gz <= Math.floor((z + reach) / 32); gz++) {
            if (cells.get(`${underground}:${gx}:${gz}`)?.some(other =>
              Math.hypot(x - other.position[0], z - other.position[2]) < Math.max(
                clusteredWorms && other.groupId !== groupId ? 6 : minimum,
                radius + other.radius + (clusteredWorms && other.groupId !== groupId ? 5 : gap))
                + Math.max(extra, other.extra))) return;
          }
        }
        destination = ports.place(entity, x, z, radius);
      };
      const offset = (clusteredWorms ? .3 : underground ? 1 : 4) * Math.sqrt(sample('offset'));
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
      reserve({ position, radius, underground, extra, groupId });
    }
    result.push({ ...source, id: source?.id ?? `${groupId}_spaced`, groupId,
      regionId: ordinary[0]!.regionId, centre,
      radius: enclosed ? source.radius : Math.max(...anchors.map(point => Math.hypot(point[0] - centre[0], point[1] - centre[1]))) + 8,
      anchors, activity: source?.activity ?? 'patrol', dressing: source?.dressing ?? [],
      roamRadius: enclosed ? source.roamRadius ?? 1.5 : ports.underground(ordinary[0]!.regionId) ? .75 : 1.5 });
  }
  return result;
}
