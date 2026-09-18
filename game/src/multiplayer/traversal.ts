import type { SemanticEntity } from "../contracts.js";
import type { GameState } from "../state/store.js";
import { sampleTraversal, type TraversalSample } from "../systems/traversalMotion.js";

/** Draw the production traversal curve without predicting its success roll or changing placement. */
export function replicatedTraversal(state: GameState, entity: (id: string) => SemanticEntity | undefined, atMs: number): TraversalSample | null {
  const activity = state.activity;
  if (activity?.kind !== "traversing") return null;
  const obstacle = entity(activity.obstacleId);
  if (!obstacle?.obstacle) return null;
  const duration = obstacle.obstacle.durationMs ?? 3000;
  return sampleTraversal(obstacle, state.player.position, activity.exitPosition ?? obstacle.obstacle.exitPosition,
    1 - (activity.endsAtMs - atMs) / duration);
}
