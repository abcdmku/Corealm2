interface NativeLocomotion {
  locomotionPolicy?: "speed-matched";
  impliedWalkMps?: number;
  impliedRunMps?: number;
}

/** Selects the authored gait; the returned reference remains in source-model metres/second. */
export function selectSpeedMatchedLocomotion<Motion extends string>(
  requestedMotion: Motion,
  actualSpeedMps: number | undefined,
  native: NativeLocomotion | undefined,
  drawnStrideScale = 1,
): { motion: Motion | "walk"; nativeReferenceSpeed: number | undefined } {
  const legacyReference = requestedMotion === "run"
    ? native?.impliedRunMps ?? native?.impliedWalkMps
    : requestedMotion === "walk" ? native?.impliedWalkMps : undefined;
  const unchanged = { motion: requestedMotion, nativeReferenceSpeed: legacyReference };
  if (native?.locomotionPolicy !== "speed-matched" || requestedMotion !== "run"
    || actualSpeedMps === undefined || !Number.isFinite(actualSpeedMps) || actualSpeedMps <= 0) return unchanged;
  const walk = native.impliedWalkMps, run = native.impliedRunMps;
  if (walk === undefined || run === undefined || !Number.isFinite(walk) || !Number.isFinite(run)
    || walk <= 0 || run <= walk) return unchanged;
  // Match the retimer's mirrored/degenerate placement-scale convention.
  const scale = Number.isFinite(drawnStrideScale) && Math.abs(drawnStrideScale) > 1e-6
    ? Math.abs(drawnStrideScale) : 1;
  const midpoint = (walk / 2 + run / 2) * scale;
  return actualSpeedMps < midpoint
    ? { motion: "walk", nativeReferenceSpeed: walk }
    : unchanged;
}
