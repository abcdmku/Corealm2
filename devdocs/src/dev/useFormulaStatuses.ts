import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { CONTENT_COLLECTIONS } from "../../../tools/content/collections.js";
import { deriveRecord, sameValue } from "../../../game/src/content/balance/derivations.js";
import type { CollectionResponse } from "../../shared/contracts.js";
import { collectionQuery } from "../api/client.js";

import { type FormulaStatus } from "../model/formulaStatus.js";
export { FORMULA_STATUS_LABELS, type FormulaStatus } from "../model/formulaStatus.js";

export type FormulaStatusMap = ReadonlyMap<string, FormulaStatus>;

export interface FormulaStatusesResult {
  /** Statuses are keyed by the collection's registered idKey, such as logItemId or tier. */
  statuses: FormulaStatusMap;
  loading: boolean;
  error: Error | undefined;
}

const SHARED_COLLECTIONS = [
  ...CONTENT_COLLECTIONS.filter(spec => spec.name.startsWith("balance/")).map(spec => spec.name),
  "craftingTiers",
] as const;

const hasFormula = (row: Readonly<Record<string, unknown>>): boolean => row.derivation !== undefined;
const idKeyFor = (collection: string): string => CONTENT_COLLECTIONS.find(spec => spec.name === collection)?.idKey ?? "id";
const rowId = (row: Readonly<Record<string, unknown>>, idKey: string): string => String(row[idKey] ?? row.id ?? "");
const asError = (value: unknown, fallback: string): Error => value instanceof Error ? value : new Error(typeof value === "string" ? value : fallback);

/**
 * Check every formula-linked row in one collection against one shared snapshot of
 * formula inputs. The target collection is already loaded by CollectionPage and is
 * passed in as rawRows so derivations see the actual target table.
 */
export function useFormulaStatuses(
  collection: string,
  rawRows: readonly Record<string, unknown>[],
  enabled: boolean,
): FormulaStatusesResult {
  const hasDerivation = useMemo(() => rawRows.some(hasFormula), [rawRows]);
  const queries = useQueries({
    queries: useMemo(
      () => SHARED_COLLECTIONS.map(name => ({ ...collectionQuery(name), enabled: enabled && hasDerivation })),
      [enabled, hasDerivation],
    ),
  });
  // useQueries may return a fresh result array while a table is being scrolled.
  // Keep the calculation memo keyed by the snapshots and state values instead.
  const snapshots = queries.map(query => query.data as CollectionResponse | undefined);
  const pending = enabled && hasDerivation && queries.some(query => query.isPending);
  const failedQuery = enabled && hasDerivation ? queries.find(query => query.isError) : undefined;
  const queryError = failedQuery?.error;

  return useMemo(() => {
    const statuses = new Map<string, FormulaStatus>();
    const linkedRows = rawRows.filter(hasFormula);
    const sharedError = queryError === undefined ? undefined : asError(queryError, "Formula parameters could not be loaded.");
    let firstError = sharedError;

    if (!linkedRows.length) {
      for (const row of rawRows) statuses.set(rowId(row, idKeyFor(collection)), "handTuned");
      return { statuses, loading: false, error: undefined };
    }

    if (sharedError || pending || !enabled) {
      const status: FormulaStatus = sharedError ? "error" : "loading";
      for (const row of rawRows) {
        statuses.set(rowId(row, idKeyFor(collection)), hasFormula(row) ? status : "handTuned");
      }
      return { statuses, loading: pending, error: sharedError };
    }

    const tables = new Map<string, unknown>();
    // Formula inputs can include the target collection itself, for example items
    // for material/food formulas. Keep the caller's raw rows intact and read only.
    tables.set(collection, rawRows);
    for (const snapshot of snapshots) {
      if (snapshot) tables.set(snapshot.collection.name, snapshot.data);
    }

    for (const row of rawRows) {
      const id = rowId(row, idKeyFor(collection));
      if (!hasFormula(row)) {
        statuses.set(id, "handTuned");
        continue;
      }
      try {
        const derived = deriveRecord(collection, row, tables);
        if (!derived) throw new Error("This formula link could not be calculated.");
        const before = Object.fromEntries(Object.keys(derived).map(key => [key, row[key]]));
        statuses.set(id, sameValue(before, derived) ? "aligned" : "drift");
      } catch (failure) {
        const error = asError(failure, "The formula could not be calculated.");
        firstError ??= error;
        statuses.set(id, "error");
      }
    }
    return { statuses, loading: false, error: firstError };
  }, [collection, enabled, hasDerivation, pending, queryError, rawRows, ...snapshots]);
}
