/** CPU-only audit of the authored distance ledger; runtime nav detours are separate. */
import { REGIONS, WALK_SPEED_MPS } from '../game/src/content/regions.js';

const locations = new Map(REGIONS.flatMap(region => region.locations.map(location => [location.id, location] as const)));
const distance = (a: readonly [x: number, z: number], b: readonly [x: number, z: number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const graph = new Map<string, { to: string; meters: number }[]>();
function edge(from: string, to: string, meters: number) {
  graph.set(from, [...(graph.get(from) ?? []), { to, meters }]);
}
for (const region of REGIONS) {
  for (const road of region.roads) {
    const meters = road.meters ?? distance(locations.get(road.from)!.position, locations.get(road.to)!.position);
    edge(road.from, road.to, meters);
    edge(road.to, road.from, meters);
  }
  for (const adjacency of region.adjacency) edge(adjacency.fromLocationId, adjacency.toLocationId, adjacency.meters);
}
function shortest(from: string, to: string) {
  const pending = [{ id: from, meters: 0, path: [from] }];
  const seen = new Set<string>();
  while (pending.length) {
    pending.sort((a, b) => a.meters - b.meters);
    const next = pending.shift()!;
    if (seen.has(next.id)) continue;
    if (next.id === to) return next;
    seen.add(next.id);
    for (const link of graph.get(next.id) ?? []) pending.push({ id: link.to, meters: next.meters + link.meters, path: [...next.path, link.to] });
  }
  throw new Error(`No walking route from ${from} to ${to}`);
}
const round = (value: number) => Math.round(value * 100) / 100;
console.log(JSON.stringify(REGIONS.flatMap(region => region.obstacles.filter(obstacle => ['scree_slide', 'root_tunnel', 'sunder_ledge'].includes(obstacle.id)).map(obstacle => {
  const walk = shortest(obstacle.fromLocationId, obstacle.toLocationId);
  const approach = distance(locations.get(obstacle.fromLocationId)!.position, obstacle.position);
  const departure = distance(obstacle.exitPosition, locations.get(obstacle.toLocationId)!.position);
  const shortcutSeconds = (approach + departure) / WALK_SPEED_MPS + obstacle.durationMs / 1000;
  return { id: obstacle.id, path: walk.path, walkingMeters: round(walk.meters), approachMeters: round(approach), departureMeters: round(departure), savesMeters: Math.round(walk.meters - approach - departure), currentSavesMeters: obstacle.savesMeters, shortcutSeconds: round(shortcutSeconds), walkingSeconds: round(walk.meters / WALK_SPEED_MPS), secondsSaved: round(walk.meters / WALK_SPEED_MPS - shortcutSeconds) };
})), null, 2));
