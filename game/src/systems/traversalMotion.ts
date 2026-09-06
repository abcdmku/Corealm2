import type { SemanticEntity, Vec3 } from "../contracts.js";
import { traversalContactHeight } from "./traversalContacts.js";

export type TraversalKind = "climb" | "vault" | "balance" | "slide" | "passage";
export interface TraversalSample {
  position: Vec3;
  facingRad: number;
  kind: TraversalKind;
  phase: "entry" | "contact" | "travel" | "recovery";
  progress: number;
  /** Opaque before any concealed displacement, including the final outcome. */
  curtainOpacity: number;
  concealed: boolean;
  support?: { origin: Vec3; width: number; depth: number; rise: number; rotationY: number };
}
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const smooth = (n: number): number => { const t = clamp(n); return t * t * (3 - 2 * t); };

/** No RNG reads. The same motion runs until the activity resolves success or failure. */
export function sampleTraversal(entity: SemanticEntity, entry: Vec3, exit: Vec3, progress: number): TraversalSample {
  const p = clamp(progress);
  const requested = entity.meta?.traversalKind;
  const kind: TraversalKind = requested === "climb" || requested === "vault" || requested === "balance"
    || requested === "slide" || requested === "passage" ? requested
    : entity.interactions.includes("enter") ? "passage"
      : entity.interactions.includes("vault") ? "vault" : "climb";
  const distance = Math.hypot(exit[0] - entry[0], exit[1] - entry[1], exit[2] - entry[2]);
  const seconds = (entity.obstacle?.durationMs ?? 3000) / 1000;
  const first = entity.interactionPosition ?? entity.position;
  const second = entity.obstacle?.exitPosition ?? exit;
  const gap = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const reverse = gap(exit, first) < gap(exit, second);
  const contactEntry = reverse ? second : first;
  const authoredExit = reverse ? first : second;
  // A distant landing is a passage transition until an actual continuous obstacle is authored.
  const concealed = kind === "passage" || distance > Math.min(6, seconds * 2) || gap(exit, authoredExit) > 0.25;
  const travel = smooth((p - 0.16) / 0.70);
  const approach = smooth(p / 0.16);
  const position: [number, number, number] = concealed ? [...entry] : [
    p < 0.16 ? entry[0] + (contactEntry[0] - entry[0]) * approach : contactEntry[0] + (exit[0] - contactEntry[0]) * travel,
    p < 0.16 ? entry[1] + (contactEntry[1] - entry[1]) * approach : contactEntry[1] + (exit[1] - contactEntry[1]) * travel,
    p < 0.16 ? entry[2] + (contactEntry[2] - entry[2]) * approach : contactEntry[2] + (exit[2] - contactEntry[2]) * travel,
  ];
  // Vault hips clear a waist-high obstacle. Climb/balance/slide stay on the authored contact line.
  if (!concealed && kind === "vault") position[1] += Math.sin(Math.PI * travel) * 0.85;
  const contactDepth = entity.meta?.traversalContactDepth;
  const contactRise = entity.meta?.traversalRise;
  const contactWidth = entity.meta?.traversalContactWidth;
  let support: TraversalSample["support"];
  if (!concealed && p >= 0.16 && typeof contactDepth === "number" && typeof contactRise === "number" && kind !== "vault") {
    const yaw = entity.view?.rotationY ?? 0;
    const along = (position[0] - entity.position[0]) * Math.sin(yaw)
      + (position[2] - entity.position[2]) * Math.cos(yaw);
    const contactWeight = smooth((along + contactDepth / 2 + 0.45) / 0.45)
      * (1 - smooth((along - contactDepth / 2) / 0.45));
    position[1] += (entity.position[1] - position[1]) * contactWeight
      + traversalContactHeight(kind, along, contactDepth, contactRise);
    if (typeof contactWidth === "number") support = { origin: entity.position, width: contactWidth,
      depth: contactDepth, rise: contactRise, rotationY: yaw };
  }
  return { position, facingRad: Math.atan2(exit[0] - entry[0], exit[2] - entry[2]), kind,
    phase: p < 0.12 ? "entry" : p < 0.22 ? "contact" : p < 0.86 ? "travel" : "recovery",
    progress: p, concealed, curtainOpacity: concealed ? smooth((p - 0.04) / 0.14) : 0,
    ...(support ? { support } : {}) };
}

export interface TraversalPresentationPort {
  begin(sample: TraversalSample): void;
  update(sample: TraversalSample): void;
  /** Called after semantic placement; adapters must wait for the destination to render before revealing. */
  end(reason: string, position: Vec3): void;
  /** Refuse a concealed commit until an opaque frame has actually painted. */
  readyToCommit?(): boolean;
}
