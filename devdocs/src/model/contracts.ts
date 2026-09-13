/** Root-owned UI interfaces. View workers consume these and report needed changes. */
export type ContentRow = Record<string, unknown>;
export interface AppProps {
  collection?: string;
  recordId?: string;
  navigate: (collection?: string, recordId?: string) => void;
}
export interface EntityDetailProps {
  collection: string;
  record: ContentRow;
  recordId?: string;
  editable?: boolean;
  collectionShape?: "array" | "object";
  navigate: AppProps["navigate"];
}
