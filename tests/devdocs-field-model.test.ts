import { describe, expect, it } from "vitest";
import {
  applyMixedOp, clampNumber, describeRevert, evaluateNumber, fieldTransition, formatNumber, mixedEdit,
  parseMixedEdit, scrubDelta, stepValue,
} from "../devdocs/src/ui/field/model.js";

describe("field state machine", () => {
  it("walks idle → focused → editing and commits on Enter while staying focused", () => {
    expect(fieldTransition("idle", "focus")).toEqual({ phase: "focused", commit: false, cancel: false });
    expect(fieldTransition("focused", "type")).toEqual({ phase: "editing", commit: false, cancel: false });
    expect(fieldTransition("editing", "enter")).toEqual({ phase: "focused", commit: true, cancel: false });
  });
  it("commits on Tab, blur, step and scrub release, and Escape restores without committing", () => {
    expect(fieldTransition("editing", "tab")).toEqual({ phase: "idle", commit: true, cancel: false });
    expect(fieldTransition("editing", "blur")).toEqual({ phase: "idle", commit: true, cancel: false });
    expect(fieldTransition("focused", "step")).toEqual({ phase: "focused", commit: true, cancel: false });
    expect(fieldTransition("editing", "scrub-release")).toEqual({ phase: "focused", commit: true, cancel: false });
    expect(fieldTransition("editing", "escape")).toEqual({ phase: "focused", commit: false, cancel: true });
  });
  it("does not commit when nothing was edited", () => {
    expect(fieldTransition("focused", "blur")).toEqual({ phase: "idle", commit: false, cancel: false });
    expect(fieldTransition("focused", "enter")).toEqual({ phase: "focused", commit: false, cancel: false });
    expect(fieldTransition("focused", "escape")).toEqual({ phase: "focused", commit: false, cancel: false });
    expect(fieldTransition("idle", "type")).toEqual({ phase: "idle", commit: false, cancel: false });
  });
});

describe("stepValue", () => {
  it("steps by 1×, 10× and 0.1× the step", () => {
    expect(stepValue(10, "ArrowUp", {}, { step: 1 })).toBe(11);
    expect(stepValue(10, "ArrowDown", {}, { step: 1 })).toBe(9);
    expect(stepValue(10, "ArrowUp", { shift: true }, { step: 1 })).toBe(20);
    expect(stepValue(10, "ArrowUp", { alt: true }, { step: 1 })).toBe(10.1);
    expect(stepValue(10, "ArrowUp", { shift: true }, { step: 0.5 })).toBe(15);
  });
  it("defaults the step to 1, ignores other keys and clamps to min/max", () => {
    expect(stepValue(3, "ArrowUp", {})).toBe(4);
    expect(stepValue(3, "ArrowLeft", {})).toBe(3);
    expect(stepValue(99, "ArrowUp", { shift: true }, { max: 100 })).toBe(100);
    expect(stepValue(0.5, "ArrowDown", {}, { min: 0 })).toBe(0);
  });
  it("never steps an integer field by less than one and keeps floats tidy", () => {
    expect(stepValue(7, "ArrowUp", { alt: true }, { integer: true })).toBe(8);
    expect(stepValue(7, "ArrowDown", { alt: true }, { integer: true, step: 5 })).toBe(6);
    expect(stepValue(0.1, "ArrowUp", {}, { step: 0.2 })).toBe(0.3);
  });
  it("clampNumber rounds integers before clamping", () => {
    expect(clampNumber(2.6, { integer: true, max: 3 })).toBe(3);
    expect(clampNumber(-1, { min: 0 })).toBe(0);
    expect(clampNumber(0.1 + 0.2)).toBe(0.3);
  });
});

describe("evaluateNumber", () => {
  it("accepts plain numbers including negatives, decimals and exponents", () => {
    expect(evaluateNumber(" 42 ")).toEqual({ ok: true, value: 42 });
    expect(evaluateNumber("-1.5")).toEqual({ ok: true, value: -1.5 });
    expect(evaluateNumber(".5")).toEqual({ ok: true, value: 0.5 });
    expect(evaluateNumber("1e3")).toEqual({ ok: true, value: 1000 });
  });
  it("rejects text, empty input and arithmetic without the = prefix", () => {
    expect(evaluateNumber("")).toMatchObject({ ok: false });
    expect(evaluateNumber("abc")).toMatchObject({ ok: false });
    expect(evaluateNumber("3*4")).toMatchObject({ ok: false });
    expect(evaluateNumber("12px")).toMatchObject({ ok: false });
  });
  it("evaluates = expressions with precedence, parentheses, unary minus and powers", () => {
    expect(evaluateNumber("=3*4")).toEqual({ ok: true, value: 12 });
    expect(evaluateNumber("=2400*0.75")).toEqual({ ok: true, value: 1800 });
    expect(evaluateNumber("=1+2*3")).toEqual({ ok: true, value: 7 });
    expect(evaluateNumber("=(1+2)*3")).toEqual({ ok: true, value: 9 });
    expect(evaluateNumber("=-2^2")).toEqual({ ok: true, value: 4 });
    expect(evaluateNumber("=2^3^2")).toEqual({ ok: true, value: 512 });
    expect(evaluateNumber("=10/4")).toEqual({ ok: true, value: 2.5 });
    expect(evaluateNumber("= 8 - 3 - 2")).toEqual({ ok: true, value: 3 });
    expect(evaluateNumber("=0.1+0.2")).toEqual({ ok: true, value: 0.3 });
  });
  it("reports malformed expressions instead of throwing", () => {
    expect(evaluateNumber("=")).toMatchObject({ ok: false });
    expect(evaluateNumber("=(1+2")).toMatchObject({ ok: false, message: "Missing )" });
    expect(evaluateNumber("=1/0")).toMatchObject({ ok: false, message: "Division by zero" });
    expect(evaluateNumber("=2*")).toMatchObject({ ok: false });
    expect(evaluateNumber("=2 3")).toMatchObject({ ok: false });
    expect(evaluateNumber("=alert(1)")).toMatchObject({ ok: false });
    expect(evaluateNumber("=1;2")).toMatchObject({ ok: false });
  });
});

describe("scrubDelta", () => {
  it("moves one step per 4px horizontally", () => {
    expect(scrubDelta(40, 0, 1)).toBe(10);
    expect(scrubDelta(-40, 0, 1)).toBe(-10);
    expect(scrubDelta(3, 0, 1)).toBe(0);
    expect(scrubDelta(40, 0, 0.5)).toBe(5);
  });
  it("rates by vertical distance: 10× above 60px, 0.1× below 60px", () => {
    expect(scrubDelta(40, -61, 1)).toBe(100);
    expect(scrubDelta(40, -60, 1)).toBe(10);
    expect(scrubDelta(40, 61, 1)).toBe(1);
    expect(scrubDelta(40, 60, 1)).toBe(10);
  });
});

describe("mixedEdit", () => {
  it("applies relative edits to the current value", () => {
    expect(mixedEdit("+10", 5)).toEqual({ ok: true, value: 15 });
    expect(mixedEdit("-5", 5)).toEqual({ ok: true, value: 0 });
    expect(mixedEdit("*1.1", 100)).toEqual({ ok: true, value: 110 });
    expect(mixedEdit("/2", 9)).toEqual({ ok: true, value: 4.5 });
    expect(mixedEdit("+ 2.5", 1)).toEqual({ ok: true, value: 3.5 });
  });
  it("replaces with a plain number or an = expression", () => {
    expect(mixedEdit("7", 100)).toEqual({ ok: true, value: 7 });
    expect(mixedEdit("=3*4", 100)).toEqual({ ok: true, value: 12 });
  });
  it("rejects nonsense and division by zero", () => {
    expect(mixedEdit("/0", 4)).toMatchObject({ ok: false, message: "Division by zero" });
    expect(mixedEdit("+x", 4)).toMatchObject({ ok: false });
    expect(mixedEdit("", 4)).toMatchObject({ ok: false });
  });
  it("exposes the parsed op so a multi-select can apply it per record", () => {
    const parsed = parseMixedEdit("*2");
    expect(parsed).toEqual({ ok: true, op: { kind: "mul", value: 2 } });
    if (parsed.ok) expect([1, 2, 3].map(value => applyMixedOp(parsed.op, value))).toEqual([2, 4, 6]);
  });
});

describe("formatting and revert descriptions", () => {
  it("formats buffers at full precision and without float noise", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(1800)).toBe("1800");
    expect(formatNumber(undefined)).toBe("");
  });
  it("names what the revert glyph returns to", () => {
    const grazer = { collection: "creatureProfiles", id: "grazer", label: "Grazer" };
    expect(describeRevert({ origin: { kind: "curve", source: grazer, expression: "2400" }, value: 2400 }, "ms")).toBe("Use Grazer curve (2400 ms)");
    expect(describeRevert({ origin: { kind: "inherited", from: { ...grazer, label: "Heath Jack" } }, value: 1800 })).toBe("Use Heath Jack value (1800)");
    expect(describeRevert({ origin: { kind: "default" }, value: 0 })).toBe("Use default (0)");
  });
});
