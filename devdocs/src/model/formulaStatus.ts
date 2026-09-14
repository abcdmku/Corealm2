export type FormulaStatus = 'compiled' | 'authored' | 'error' | 'loading';
export const FORMULA_STATUS_LABELS: Readonly<Record<FormulaStatus,string>> = {compiled:'Calculated',authored:'Authored',error:'Build error',loading:'Checking build'};
