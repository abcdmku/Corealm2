import { CROWNWARD } from "../content/crownward.js";
import { CROWNWARD_CASTLES } from "../render/compositions/crownwardCastles.js";
import type { MusicArea } from "./catalog.js";

/** Castle footprints plus 20 m of grounds; five extra metres before returning to plains. */
export const CROWNWARD_MUSIC_AREAS: readonly MusicArea[] = CROWNWARD.landmarks.flatMap(landmark => {
  if (landmark.composition !== "crownward_castle" && landmark.composition !== "crownward_fortress") return [];
  const [width, depth] = CROWNWARD_CASTLES[landmark.composition].footprint;
  return [{ id: landmark.id, music: "music.castle", centre: landmark.position,
    radius: Math.hypot(width, depth) * (landmark.scale ?? 1) / 2 + 20, exitPadding: 5 }];
});
