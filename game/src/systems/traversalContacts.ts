import type { TraversalKind } from "./traversalMotion.js";

/** Shared physical dimensions for authored, compact production obstacles and their lab fixtures. */
export const TRAVERSAL_CONTACTS = {
  climb: { assetId: "corealm_traversal_climb", width: 1.8, depth: 1.2, rise: 1, durationMs: 4000 },
  vault: { assetId: "corealm_traversal_vault", width: 1.8, depth: 0.36, rise: 0.6, durationMs: 2600 },
  balance: { assetId: "corealm_traversal_balance", width: 0.38, depth: 3, rise: 0.24, durationMs: 4000 },
  slide: { assetId: "corealm_traversal_slide", width: 1.4, depth: 3, rise: 0.6, durationMs: 3200 },
} as const;
export type ContactTraversalKind = keyof typeof TRAVERSAL_CONTACTS;

/** Root-foot height over the exact authored support; approach and recovery happen outside it. */
export function traversalContactHeight(kind: TraversalKind, along: number, depth: number, rise: number): number {
  const front = -depth / 2;
  const back = depth / 2;
  const smooth = (value: number): number => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
  if (kind === "slide") {
    if (along < front) return rise * smooth((along - front + 0.55) / 0.55);
    if (along <= back) return rise * (back - along) / depth + 0.025;
    return 0.025 * (1 - smooth((along - back) / 0.25));
  }
  const shoulder = kind === "climb" ? 0.45 : 0.3;
  return rise * smooth((along - front + shoulder) / shoulder)
    * (1 - smooth((along - back) / shoulder));
}
