import "./formulaListStatus.css";
import { useEffect, useRef } from "react";
import { useFormulaStatuses, type FormulaStatusesResult } from "./useFormulaStatuses.js";

export interface FormulaStatusObserverProps {
  collection: string;
  rawRows: readonly Record<string, unknown>[];
  enabled: boolean;
  onChange: (result: FormulaStatusesResult) => void;
}

/** Keeps formula checking in one dev-only mounted component for a collection table. */
export default function FormulaStatusObserver({ collection, rawRows, enabled, onChange }: FormulaStatusObserverProps) {
  const result = useFormulaStatuses(collection, rawRows, enabled);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onChangeRef.current(result);
  }, [result]);

  return null;
}
