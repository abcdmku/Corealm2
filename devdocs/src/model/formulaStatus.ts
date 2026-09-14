/** Lightweight labels shared by table rendering and the development-only calculator. */
export type FormulaStatus = "aligned" | "drift" | "handTuned" | "error" | "loading";
export const FORMULA_STATUS_LABELS: Readonly<Record<FormulaStatus, string>> = {
  aligned: "Formula aligned", drift: "Formula drift", handTuned: "Hand tuned",
  error: "Formula error", loading: "Checking formula",
};
