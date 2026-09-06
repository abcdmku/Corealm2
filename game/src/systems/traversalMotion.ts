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
  // The cover is a fixed 0.15 s beat plus a 0.4 s fade, expressed as a fraction of this
  // obstacle's own duration. As a fixed progress span it was 0.18 of the activity, which is
  // 0.36 s on the 2 s Brook Planks but 1.08 s on the 6 s Broken Ledge - over a second of a
  // motionless actor in plain view before the screen covered the crossing.
  const coverHold = Math.min(0.3, 0.15 / seconds);
  const coverFade = Math.min(0.4, 0.4 / seconds);
  const covered = coverHold + coverFade;
  const travel = smooth((p - 0.16) / 0.70);
  const approach = smooth(p / 0.16);
  // A concealed crossing still steps onto its authored entrance before the cover closes, so the
  // visible beat is the start of a real move rather than an idle stand followed by a fade. Only
  // in XZ: an authored obstacle's entity origin is not always a stance — the Fallen Ash is a
  // 10.7 m beam whose origin sits 5.77 m under the ground its drawn end rests on — and the
  // player is already standing on the surface this beat is drawn against.
  const position: [number, number, number] = concealed ? [
    entry[0] + (contactEntry[0] - entry[0]) * smooth(p / covered),
    entry[1],
    entry[2] + (contactEntry[2] - entry[2]) * smooth(p / covered),
  ] : [
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
    progress: p, concealed, curtainOpacity: concealed ? smooth((p - coverHold) / coverFade) : 0,
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
