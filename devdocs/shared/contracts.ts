/** Root-owned API contracts. Domain workers report proposed changes before editing this file. */
export interface CollectionSummary {
  name: string;
  count: number;
  editable: boolean;
  idKey: string;
  shape: "array" | "object";
}
export interface CollectionResponse {
  collection: CollectionSummary;
  revision: string;
  data: unknown;
}
export interface ApiDiagnostic { path: string; message: string; severity: "error" | "warning" }
export interface ApiError { error: string; diagnostics?: ApiDiagnostic[] }

export type BulkAction = { kind: 'status'; status: 'draft' | 'candidate' | 'rejected' }
  | { kind: 'note'; text: string; label?: string }
  | { kind: 'retier'; tier: number; unlinkFormulas: boolean };
export interface BulkRequest {
  operation: 'preview' | 'apply'; collection: string; recordIds: string[]; action: BulkAction;
  revisions?: { content: string; meta?: string };
}
export interface BulkResponse {
  collection: string; recordIds: string[]; action: BulkAction;
  revisions: { content: string; meta?: string };
  diffs: { recordId: string; before: Record<string, unknown>; after: Record<string, unknown> }[];
  diagnostics: ApiDiagnostic[];
}
