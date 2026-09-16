/*
  Where a value comes from. Every editable value in the codex resolves to a chain of links: the
  first link explains the value the game sees, the rest are what it beat. A variant's attack speed
  might resolve to [inherited from Heath Jack = 1800, curve Grazer = 2400]: the field shows 1800,
  says "from Heath Jack · was 2400 from Grazer", and reverting hands the value back to the curve.

  `model/derive.ts` builds chains; `ui/field` draws them. Nothing here touches React or the DOM.
*/

export type Path = readonly (string | number)[];

/** A record another value points at, with the label to print and an optional path inside it. */
export interface RecordRef { collection: string; id: string; label: string; path?: string }

export type Origin =
  /** Authored on the record being edited. */
  | { kind: "own" }
  /** Copied from a base record (creature variant → base, item → template). */
  | { kind: "inherited"; from: RecordRef }
  /** Computed by a curve or formula whose parameters live in `source`. */
  | { kind: "curve"; source: RecordRef; expression: string }
  /** A balance target the stored value is compared against (set thresholds, fuels). */
  | { kind: "balance"; source: RecordRef }
  /** The schema default; the key is absent on disk. */
  | { kind: "default" }
  /** Nothing sets it and nothing computes it: an optional value that is simply not there. */
  | { kind: "absent" };

export interface Link<T = unknown> { origin: Origin; value: T }

export interface Resolved<T = unknown> {
  /** What the game sees. Equals `chain[0].value` unless the chain is empty. */
  value: T;
  /** `chain[0]` explains `value`; `chain[1..]` are the links it beat, nearest first. */
  chain: readonly Link<T>[];
  /** Where an edit to this value is written on the record being edited. */
  path: Path;
  /** Set when the winning value is stored on another record (the base's adjustment, a tier row). */
  storedOn?: RecordRef;
}

/**
 * The state a field draws. `overridden` means an own value beats a curve, an inherited value or a
 * balance target; an own value that merely beats a schema default is plain `own` (flagging those
 * would make every field an override, the Unity position problem).
 */
export type OriginState = "own" | "overridden" | "inherited" | "curve" | "balance" | "default" | "absent";

export function originState(resolved: Resolved<unknown>): OriginState {
  const head = resolved.chain[0]?.origin;
  if (!head) return "absent";
  if (head.kind === "own") {
    const next = resolved.chain[1]?.origin;
    return next && (next.kind === "curve" || next.kind === "inherited" || next.kind === "balance") ? "overridden" : "own";
  }
  return head.kind;
}

/** The link an edit-free revert hands the value back to, if there is one. */
export function revertTarget<T>(resolved: Resolved<T>): Link<T> | undefined {
  return originState(resolved) === "overridden" || originState(resolved) === "own" ? resolved.chain[1] : undefined;
}

export const fmtValue = (value: unknown, digits = 2): string => {
  if (value === undefined || value === null) return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(digits)));
  if (Array.isArray(value)) return value.map(entry => fmtValue(entry, digits)).join(" – ");
  return String(value);
};

export interface ChainPhrase { text: string; ref?: RecordRef }

/** Prose, not data: a beaten value is a reminder, so long text is cut rather than wrapped. */
const LONG_VALUE = 28;
const shorten = (text: string): string => text.length > LONG_VALUE ? `${text.slice(0, LONG_VALUE - 1).trimEnd()}…` : text;

/**
 * The provenance line as phrases: `[{text:"from "},{text:"Heath Jack",ref},{text:" · was 2400 from "},{text:"Grazer",ref}]`.
 * A caller joins the texts for a tooltip or renders each `ref` as a link.
 */
export function describeChain(resolved: Resolved<unknown>, unit?: string): ChainPhrase[] {
  const out: ChainPhrase[] = [];
  const withUnit = (value: unknown) => `${shorten(fmtValue(value))}${unit && typeof value === "number" ? ` ${unit}` : ""}`;
  // A record's own name is its label, so "was Gloam Fox from Gloam Fox" says it twice.
  const sameAsSource = (value: unknown, label: string) => typeof value === "string" && value === label;
  const [head, ...rest] = resolved.chain;
  if (!head) return out;
  const state = originState(resolved);
  if (state === "inherited" && head.origin.kind === "inherited") out.push({ text: "from " }, { text: head.origin.from.label, ref: head.origin.from });
  else if (state === "curve" && head.origin.kind === "curve") out.push({ text: "from " }, { text: head.origin.source.label, ref: head.origin.source });
  else if (state === "balance" && head.origin.kind === "balance") out.push({ text: "target from " }, { text: head.origin.source.label, ref: head.origin.source });
  else if (state === "default") out.push({ text: "default" });
  for (const link of rest) {
    const origin = link.origin;
    if (origin.kind === "curve") out.push({ text: `${out.length ? " · " : ""}was ${withUnit(link.value)} from ` }, { text: origin.source.label, ref: origin.source });
    else if (origin.kind === "inherited") {
      const lead = out.length ? " · " : "";
      if (sameAsSource(link.value, origin.from.label)) out.push({ text: `${lead}was ` }, { text: origin.from.label, ref: origin.from });
      else out.push({ text: `${lead}was ${withUnit(link.value)} from ` }, { text: origin.from.label, ref: origin.from });
    }
    else if (origin.kind === "balance") out.push({ text: `${out.length ? " · " : ""}target ${withUnit(link.value)} from ` }, { text: origin.source.label, ref: origin.source });
    else if (origin.kind === "default") out.push({ text: `${out.length ? " · " : ""}default ${withUnit(link.value)}` });
  }
  return out;
}

export const chainText = (resolved: Resolved<unknown>, unit?: string): string => describeChain(resolved, unit).map(phrase => phrase.text).join("");
