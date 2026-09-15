import type { Link } from "../../model/origin.js";
import { fmtValue } from "../../model/origin.js";

/*
  The field's logic without React: the idle → focused → editing state machine, number stepping,
  the `=` calculator, scrub rates and the relative edits a multi-select accepts. `Field.tsx` and the
  controls call these; `tests/devdocs-field-model.test.ts` pins them.
*/

export type FieldPhase = "idle" | "focused" | "editing";
export type FieldEvent = "focus" | "blur" | "type" | "enter" | "escape" | "tab" | "step" | "scrub-release";
export interface FieldTransition { phase: FieldPhase; commit: boolean; cancel: boolean }

/** Commit points are Enter, Tab, blur, an arrow step and a scrub release. Escape cancels an edit. */
export function fieldTransition(phase: FieldPhase, event: FieldEvent): FieldTransition {
  const to = (next: FieldPhase, commit = false, cancel = false): FieldTransition => ({ phase: next, commit, cancel });
  switch (event) {
    case "focus": return to(phase === "idle" ? "focused" : phase);
    case "blur": return to("idle", phase === "editing");
    case "type": return to(phase === "idle" ? "idle" : "editing");
    case "enter": return phase === "editing" ? to("focused", true) : to(phase);
    case "tab": return to("idle", phase === "editing");
    case "escape": return phase === "editing" ? to("focused", false, true) : to(phase);
    case "step": return to(phase === "idle" ? "idle" : "focused", phase !== "idle");
    case "scrub-release": return to(phase === "idle" ? "idle" : "focused", true);
  }
}

export interface NumberRules { step?: number; integer?: boolean; min?: number; max?: number }

/** Floating point noise from repeated steps (0.1 + 0.2) is trimmed to 12 significant digits. */
export const tidy = (value: number): number => Number(value.toPrecision(12));

export function clampNumber(value: number, rules: NumberRules = {}): number {
  let out = rules.integer ? Math.round(value) : value;
  if (rules.min !== undefined) out = Math.max(rules.min, out);
  if (rules.max !== undefined) out = Math.min(rules.max, out);
  return tidy(out);
}

/** Up/Down move one step, Shift ten, Alt a tenth; integers never step by less than one. */
export function stepValue(value: number, key: string, modifiers: { shift?: boolean; alt?: boolean }, rules: NumberRules = {}): number {
  const direction = key === "ArrowUp" ? 1 : key === "ArrowDown" ? -1 : 0;
  if (!direction) return value;
  const base = rules.step ?? 1;
  let size = modifiers.shift ? base * 10 : modifiers.alt ? base / 10 : base;
  if (rules.integer) size = Math.max(1, Math.round(size));
  return clampNumber(value + direction * size, rules);
}

export type NumberResult = { ok: true; value: number } | { ok: false; message: string };

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** A plain number, or `=` followed by + - * / ^ and parentheses. No `eval`: a hand-written parser. */
export function evaluateNumber(text: string): NumberResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, message: "Enter a number" };
  if (trimmed.startsWith("=")) return evaluateExpression(trimmed.slice(1));
  if (!PLAIN_NUMBER.test(trimmed)) return { ok: false, message: `"${trimmed}" is not a number (start with = for maths)` };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { ok: true, value: tidy(value) } : { ok: false, message: "Out of range" };
}

type Token = { kind: "number"; value: number } | { kind: "op"; value: string };

function tokenize(source: string): Token[] | string {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) { index++; continue; }
    if (/[\d.]/.test(char)) {
      const match = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(source.slice(index));
      if (!match) return "Unexpected \".\"";
      tokens.push({ kind: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if ("+-*/^()".includes(char)) { tokens.push({ kind: "op", value: char }); index++; continue; }
    if (char === "×") { tokens.push({ kind: "op", value: "*" }); index++; continue; }
    if (char === "÷") { tokens.push({ kind: "op", value: "/" }); index++; continue; }
    return `Unexpected "${char}"`;
  }
  return tokens;
}

function evaluateExpression(source: string): NumberResult {
  const tokens = tokenize(source);
  if (typeof tokens === "string") return { ok: false, message: tokens };
  if (!tokens.length) return { ok: false, message: "Enter an expression after =" };
  let position = 0;
  const peek = (): Token | undefined => tokens[position];
  const isOp = (value: string): boolean => { const token = peek(); return token?.kind === "op" && token.value === value; };
  let failure: string | undefined;
  const fail = (message: string): number => { failure ??= message; return NaN; };

  function primary(): number {
    const token = peek();
    if (!token) return fail("Expression ends early");
    if (token.kind === "number") { position++; return token.value; }
    if (token.value === "(") {
      position++;
      const inner = expression();
      if (!isOp(")")) return fail("Missing )");
      position++;
      return inner;
    }
    position++;
    return fail(`Unexpected "${token.value}"`);
  }
  function unary(): number {
    if (isOp("-")) { position++; return -unary(); }
    if (isOp("+")) { position++; return unary(); }
    return primary();
  }
  function power(): number {
    const base = unary();
    if (isOp("^")) { position++; return Math.pow(base, power()); }
    return base;
  }
  function term(): number {
    let left = power();
    while (isOp("*") || isOp("/")) {
      const op = (peek() as { value: string }).value;
      position++;
      const right = power();
      if (op === "/" && right === 0) return fail("Division by zero");
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function expression(): number {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = (peek() as { value: string }).value;
      position++;
      const right = term();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  const value = expression();
  if (failure) return { ok: false, message: failure };
  if (position < tokens.length) return { ok: false, message: `Unexpected "${String(tokens[position]!.value)}"` };
  if (!Number.isFinite(value)) return { ok: false, message: "Not a finite number" };
  return { ok: true, value: tidy(value) };
}

/**
 * Alt+drag on a label: one step per 4px of horizontal travel. Dragging the pointer more than 60px
 * above the start point makes each step ten times larger; more than 60px below, a tenth.
 */
export function scrubDelta(dx: number, dy: number, step = 1): number {
  const rate = dy < -60 ? 10 : dy > 60 ? 0.1 : 1;
  return tidy(Math.trunc(dx / 4) * step * rate);
}

export type MixedOp = { kind: "set"; value: number } | { kind: "add"; value: number } | { kind: "mul"; value: number };
export type MixedParse = { ok: true; op: MixedOp } | { ok: false; message: string };

/** `+10`, `-5`, `*1.1`, `/2` are relative; anything else is a plain number or `=` expression. */
export function parseMixedEdit(text: string): MixedParse {
  const trimmed = text.trim();
  const match = /^([+\-*/])\s*(.+)$/.exec(trimmed);
  if (match) {
    const op = match[1]!;
    const amount = evaluateNumber(match[2]!);
    if (!amount.ok) return amount;
    if (op === "+") return { ok: true, op: { kind: "add", value: amount.value } };
    if (op === "-") return { ok: true, op: { kind: "add", value: -amount.value } };
    if (op === "*") return { ok: true, op: { kind: "mul", value: amount.value } };
    if (amount.value === 0) return { ok: false, message: "Division by zero" };
    return { ok: true, op: { kind: "mul", value: 1 / amount.value } };
  }
  const value = evaluateNumber(trimmed);
  return value.ok ? { ok: true, op: { kind: "set", value: value.value } } : value;
}

export function applyMixedOp(op: MixedOp, current: number): number {
  if (op.kind === "set") return op.value;
  if (op.kind === "add") return tidy(current + op.value);
  return tidy(current * op.value);
}

/** Apply a mixed-selection edit to one record's number. */
export function mixedEdit(text: string, current: number): NumberResult {
  const parsed = parseMixedEdit(text);
  return parsed.ok ? { ok: true, value: applyMixedOp(parsed.op, current) } : parsed;
}

/** The buffer text for a number: full precision, no exponent for ordinary magnitudes. */
export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return String(tidy(value));
}

/** "Use Grazer curve (2400 ms)": what the revert glyph will hand the value back to. */
export function describeRevert(link: Link<unknown>, unit?: string): string {
  const shown = `${fmtValue(link.value)}${unit && typeof link.value === "number" ? ` ${unit}` : ""}`;
  const origin = link.origin;
  switch (origin.kind) {
    case "curve": return `Use ${origin.source.label} curve (${shown})`;
    case "inherited": return `Use ${origin.from.label} value (${shown})`;
    case "balance": return `Use ${origin.source.label} target (${shown})`;
    case "default": return `Use default (${shown})`;
    case "own": return `Use ${shown}`;
    case "absent": return "Remove";
  }
}

export type DotState = "own" | "curve" | "inherited" | "overridden" | "balance" | "default" | "absent" | "mixed" | "invalid" | "stale";

export const DOT_LEGEND: readonly { state: DotState; label: string; meaning: string }[] = [
  { state: "own", label: "Own", meaning: "Authored on this record" },
  { state: "curve", label: "Curve", meaning: "Computed from a curve or formula" },
  { state: "inherited", label: "Inherited", meaning: "Copied from the base record" },
  { state: "overridden", label: "Overridden", meaning: "Own value beats a curve or a base" },
  { state: "mixed", label: "Mixed", meaning: "Selected records disagree" },
  { state: "invalid", label: "Invalid", meaning: "Fails validation" },
  { state: "stale", label: "Stale", meaning: "Changed on disk since it was loaded" },
];
