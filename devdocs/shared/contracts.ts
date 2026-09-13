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
