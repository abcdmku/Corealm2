import { describe, expect, it } from "vitest";
import {
  discriminated,
  lit,
  obj,
  parseValue,
  rec,
  str,
  unknown,
  type ParseContext,
} from "../game/src/content/schema/core.js";
import { MetaFileSchema } from "../tools/content/meta.js";
import { contentRevision } from "../tools/content/format.js";

function context(): ParseContext {
  return { issues: [] };
}

describe("content store foundation", () => {
  it("reports prototype names as unknown strict object fields", () => {
    const input = JSON.parse('{"value":"ok","toString":1,"constructor":2,"__proto__":3}') as unknown;
    const ctx = context();
    const parsed = obj({ value: str() }).parse(input, "row", ctx);

    expect(parsed).toEqual({ value: "ok" });
    expect(ctx.issues.map((issue) => issue.path)).toEqual([
      "row.toString",
      "row.constructor",
      "row.__proto__",
    ]);
    expect(ctx.issues.every((issue) => issue.message === "unknown field")).toBe(true);
  });

  it("diagnoses a prototype discriminant instead of calling an inherited value", () => {
    const schema = discriminated("kind", { alpha: obj({ kind: lit("alpha") }) });
    const ctx = context();

    expect(() => schema.parse({ kind: "toString" }, "entry", ctx)).not.toThrow();
    expect(ctx.issues).toEqual([{
      path: "entry.kind",
      message: 'expected one of "alpha", got "toString"',
      severity: "error",
    }]);
  });

  it("keeps an own __proto__ record key without changing the result prototype", () => {
    const input = JSON.parse('{"__proto__":{"poisoned":true},"safe":"ok"}') as Record<string, unknown>;
    const ctx = context();
    const parsed = rec(unknown()).parse(input, "meta", ctx) as Record<string, unknown>;

    expect(ctx.issues).toEqual([]);
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed["__proto__"]).toEqual({ poisoned: true });
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).poisoned).toBeUndefined();
  });

  it("rejects a null metadata record instead of silently dropping it", () => {
    expect(() => parseValue(MetaFileSchema, { broken: null }, "meta")).toThrow(
      /meta\.broken: expected object, got null/,
    );
  });

  it("uses a stable SHA-256 revision for content bytes", () => {
    expect(contentRevision("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(contentRevision("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(contentRevision("abc")).toBe(contentRevision("abc"));
    expect(contentRevision("abc")).not.toBe(contentRevision("abc\n"));
  });
});
