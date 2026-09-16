import type { Schema } from "../../../../game/src/content/schema/core.js";
import type { ContentRow } from "../../model/contracts.js";
import { getPath, setPath, type Path } from "../../model/draft.js";
import { fieldPath } from "../../model/fields.js";
import { draftKey, type DraftStore } from "../../model/store.js";
import { applyMixedOp, clampNumber, type MixedOp, type NumberRules } from "../field/model.js";

/*
  One edit applied to one or many records through the draft store. Each record gets its own
  commit labelled with the path, so the shell bar counts "N records changed", Ctrl+Z undoes one
  record at a time and Save all writes them as one transaction. The grid and the palette both use
  this; `tests/devdocs-grid-model.test.ts` drives it against `createDraftStore()`.
*/

export interface EditContext {
  store: DraftStore;
  collection: string;
  idKey: string;
  /** The collection revision the rows were loaded with. */
  revision: string;
  /** Lets a leaf inside an untagged union replace the variant it does not belong to. */
  schema?: Schema;
}

export interface EditTarget { id: string; row: ContentRow }

export type CellEdit =
  | { kind: "set"; value: unknown }
  /** A relative number edit (`+10`, `*1.1`) from a mixed cell; records without a number keep theirs. */
  | { kind: "op"; op: MixedOp; rules?: NumberRules };

/** Apply `edit` at `path` on every target. Returns how many records changed. */
export function applyEdit(context: EditContext, targets: readonly EditTarget[], path: Path, edit: CellEdit): number {
  let changed = 0;
  for (const target of targets) {
    const key = draftKey(context.collection, target.id);
    context.store.adopt({ collection: context.collection, id: target.id, objectShaped: false, idKey: context.idKey, record: target.row, revision: context.revision });
    const current = context.store.entry(key)?.draft;
    if (current === undefined) continue;
    const before = getPath(current, path);
    let value: unknown;
    if (edit.kind === "set") value = edit.value;
    else {
      if (typeof before !== "number" && edit.op.kind !== "set") continue;
      value = clampNumber(applyMixedOp(edit.op, typeof before === "number" ? before : 0), edit.rules);
    }
    const next = place(current, path, value, context.schema);
    if (JSON.stringify(next) === JSON.stringify(current)) continue;
    context.store.commit(key, next, path.join("."));
    changed++;
  }
  return changed;
}

/**
 * `setPath`, except when the leaf's parent is an untagged union and the current variant lacks the
 * leaf: then the variant is replaced ("drops" becomes "tableId") instead of being merged into one
 * object that matches neither member.
 */
export function place(record: ContentRow, path: Path, value: unknown, schema?: Schema): ContentRow {
  if (schema && path.length > 1) {
    const parentPath = path.slice(0, -1);
    const leaf = path[path.length - 1]!;
    const parent = getPath(record, parentPath);
    const parentSpec = fieldPath(schema, parentPath, record);
    const untaggedUnion = parentSpec?.variants && !parentSpec.discriminator;
    if (untaggedUnion && typeof leaf === "string" && parent !== null && typeof parent === "object" && !Array.isArray(parent) && !Object.hasOwn(parent, leaf)) {
      return setPath(record, parentPath, { [leaf]: value });
    }
  }
  return setPath(record, path, value);
}
