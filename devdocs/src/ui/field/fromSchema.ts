import { ObjectSchema, type RefKind, type Schema } from "../../../../game/src/content/schema/core.js";
import { fieldCore, serialFieldSpec } from "../../model/fields.js";

/*
  Everything a page needs to declare a field, read from the schema instead of a hand-written table.
  Pass an object schema and a key (`useField(creatureSchema, "attackSpeedMs")`) or a field schema
  and the name to title it with.
*/

export interface SchemaFieldSpec {
  label: string;
  hint?: string;
  unit?: string;
  step?: number;
  integer?: boolean;
  min?: number;
  max?: number;
  choices?: string[];
  ref?: RefKind;
  optional: boolean;
  multiline: boolean;
  readOnly: boolean;
  kind: string;
}

export function fieldFromSchema(schema: Schema, key: string): SchemaFieldSpec {
  const core = fieldCore(schema);
  const node = core instanceof ObjectSchema && Object.hasOwn(core.fields, key) ? core.fields[key] as Schema : schema;
  const spec = serialFieldSpec(node, key);
  const min = spec.min ?? (spec.exclusiveMin !== undefined ? spec.exclusiveMin + (spec.integer ? 1 : Number.EPSILON) : undefined);
  const max = spec.max ?? (spec.exclusiveMax !== undefined ? spec.exclusiveMax - (spec.integer ? 1 : Number.EPSILON) : undefined);
  return {
    label: spec.label, hint: spec.help, unit: spec.unit, step: spec.step, integer: spec.integer, min, max,
    choices: spec.choices?.map(choice => String(choice)), ref: spec.ref,
    optional: spec.optional || spec.nullable, multiline: Boolean(spec.multiline), readOnly: Boolean(spec.readOnly), kind: spec.kind,
  };
}

/** Alias for pages that read as hooks. It is pure; call it anywhere. */
export const useField = fieldFromSchema;
