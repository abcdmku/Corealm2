import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { CONTENT_COLLECTIONS } from "../../../../tools/content/collections.js";
import type { AppProps } from "../../model/contracts.js";
import { fieldPath } from "../../model/fields.js";
import { incomingReferences, roleLabel, summaryContext, useReferenceIndex, type IncomingReference } from "../../model/refs.js";
import { usePeek } from "../Peek.js";
import { RefRow } from "../RefChip.js";
import { Section } from "../Sheet.js";
import { labelFor } from "../library.js";

/*
  The standard closing section of every record page (docs/devdocs-inputs.md §3.5): everything that
  points at this record, grouped by the relationship the referencing field expresses. The group
  name is the schema `role` on that field ("Dropped by", "Rolled by", "Base of"); a field with no
  role falls back to `roleLabel`'s path heuristic. Rows peek; "Open" navigates for real.
*/

export interface ReferencedByProps {
  collection: string;
  id: string;
  /** Rows per group before "Show all". */
  cap?: number;
  /** For the "Open" action. Defaults to the peek provider's navigate. */
  navigate?: AppProps["navigate"];
  title?: string;
}

const schemaByCollection = new Map(CONTENT_COLLECTIONS.map(spec => [spec.name, spec.schema]));

/** `drops[0].itemId` → `["drops", 0, "itemId"]`. */
export function parseReferencePath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const match of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) out.push(match[2] !== undefined ? Number(match[2]) : match[1]!);
  return out;
}

const sentence = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** The relationship a reference expresses, from the target's side. */
export function relationshipLabel(reference: Pick<IncomingReference, "collection" | "path" | "record">): string {
  const schema = schemaByCollection.get(reference.collection.replace(/^compiled-/, ""));
  const spec = schema ? fieldPath(schema, parseReferencePath(reference.path), reference.record) : undefined;
  return spec?.role ?? sentence(roleLabel(reference.path));
}

interface Group { label: string; rows: IncomingReference[] }

export function groupReferences(incoming: readonly IncomingReference[]): Group[] {
  const groups = new Map<string, Group>();
  for (const reference of incoming) {
    const label = relationshipLabel(reference);
    let group = groups.get(label);
    if (!group) { group = { label, rows: [] }; groups.set(label, group); }
    if (!group.rows.some(row => row.collection === reference.collection && row.recordId === reference.recordId)) group.rows.push(reference);
  }
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
}

export function ReferencedBy({ collection, id, cap = 40, navigate, title = "Referenced by" }: ReferencedByProps) {
  const { index, loading } = useReferenceIndex();
  const ctx = useMemo(() => summaryContext(index), [index]);
  const peek = usePeek();
  const incoming = useMemo(() => incomingReferences(index, collection, id), [index, collection, id]);
  const groups = useMemo(() => groupReferences(incoming), [incoming]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const open = navigate ?? peek.navigate;

  return <Section title={title} aside={total > 0 ? <span>{total}</span> : undefined} className="refby">
    {total === 0 && <p className="empty-inline">{loading ? "Loading references…" : "Nothing references this record."}</p>}
    {groups.map(group => {
      const shown = expanded.has(group.label) ? group.rows : group.rows.slice(0, cap);
      return <div key={group.label} className="refby-group" data-role={group.label}>
        <span className="refby-group-title">{group.label}<small>{group.rows.length}</small></span>
        {shown.map(reference => <div key={`${reference.collection}:${reference.recordId}`} className="refby-row">
          <RefRow collection={reference.collection} id={reference.recordId} record={reference.record} ctx={ctx} tag={labelFor(reference.collection)} onOpen={(target, recordId) => peek.open({ collection: target, id: recordId })} />
          {open && <button type="button" className="text-button refby-open" title="Open in the workspace" aria-label={`Open ${reference.recordName}`} onClick={() => open(reference.collection, reference.recordId)}><ArrowUpRight size={11} /> Open</button>}
        </div>)}
        {group.rows.length > cap && !expanded.has(group.label) && <button type="button" className="text-button refby-more" onClick={() => setExpanded(current => new Set(current).add(group.label))}>Show all {group.rows.length}</button>}
      </div>;
    })}
  </Section>;
}
