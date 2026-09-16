import { Check, Copy } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { CONTENT_COLLECTIONS } from "../../../tools/content/collections.js";
import { ObjectSchema, type Schema } from "../../../game/src/content/schema/core.js";
import { apiGet } from "../api/client.js";
import type { ContentRow, EntityDetailProps } from "../model/contracts.js";
import { fieldCore, serialFieldSpec } from "../model/fields.js";
import { rowName } from "../model/rows.js";
import { summaryContext, useReferenceIndex } from "../model/refs.js";
import { summarize, titleCase } from "../model/summaries.js";
import { primaryAssetId } from "../model/viewerSource.js";
import type { MetaResponse } from "../../shared/metaContracts.js";
import { EntitySummary } from "../ui/EntitySummary.js";
import { Facts, Field, RefField, ReferencedBy, SchemaControl, Sheet, type RenderRef } from "../ui/field/index.js";
import { Thumb } from "../ui/Thumb.js";
import { labelFor } from "../ui/library.js";

const SetPiecePanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/SetPiecePanel.js"));
const NotesPanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/NotesPanel.js"));
const EntityEditor = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/EntityEditor.js"));
const BalancePanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/BalancePanel.js"));
const RecordActions = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/RecordActions.js"));
const AssetCandidates = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/AssetCandidates.js"));
const ADVANCED_FIELDS = new Set(["catalog", "source", "sourceInputId", "legacyOverride", "derived", "registrationOrder", "labOrder", "fantasyTierOrder", "lineage", "history", "provenance", "migration", "__compiled"]);

const schemaByCollection = new Map(CONTENT_COLLECTIONS.map(spec => [spec.name, spec.schema]));
const noop = () => undefined;
const readOnlyRef: RenderRef = (kind, value, _onChange, spec) => <RefField kind={kind} value={value} onChange={noop} label={spec.label} hint={spec.hint} readOnly className="is-bare" />;

/**
 * A record nobody can edit here — a compiled row, or the player build — read through the same
 * fields the editor uses, with every control read-only. References stay references: the chip peeks
 * at the target instead of printing an id.
 */
export function RecordFields({ collection, record }: { collection: string; record: ContentRow }) {
  const schema = schemaByCollection.get(collection) ?? schemaByCollection.get(collection.replace(/^compiled-/, ""));
  const node = schema ? fieldCore(schema) : undefined;
  if (!(node instanceof ObjectSchema)) return <pre className="record-source" style={{ padding: 0 }}>{JSON.stringify(record, null, 2)}</pre>;
  const entries = (Object.entries(node.fields) as [string, Schema][])
    .map(([key, field]) => [key, field, serialFieldSpec(field, key)] as const)
    .filter(([key, , spec]) => !ADVANCED_FIELDS.has(key) && !spec.hidden && record[key] !== undefined);
  return <Sheet>
    {/* A reference is the one field that brings its own label, so it is rendered as itself. */}
    {entries.map(([key, field, spec]) => spec.ref
      ? <RefField key={key} kind={spec.ref} value={typeof record[key] === "string" ? record[key] : undefined} onChange={noop} label={spec.label} hint={spec.help} readOnly />
      : <SchemaControl key={key} schema={field} name={key} value={record[key]} onChange={noop} renderRef={readOnlyRef} readOnly />)}
    {!entries.length && <Field label="Record"><span className="field-static muted">This record has no readable fields.</span></Field>}
  </Sheet>;
}

/**
 * The generic record page: used by every collection without a purpose-built view. One column of
 * fields with a context rail. Rows expanded from a tier or a role are edited like any other; the
 * page does not call them generated.
 */
export function EntityDetail(props: EntityDetailProps) {
  const { collection, record, navigate } = props;
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("edit");
  const [visited, setVisited] = useState(() => new Set(["edit"]));
  const { index } = useReferenceIndex();
  const ctx = useMemo(() => summaryContext(index), [index]);
  const summary = summarize(collection, record, ctx);
  const id = props.recordId ?? String(record.id ?? record.itemId ?? record.logItemId ?? record.tier ?? "");
  const generated = record.__compiled === true || collection.startsWith("compiled-");
  const canEdit = !__DEVDOCS_PLAYER__ && props.editable && !generated;
  const isBalance = collection.startsWith("balance/");
  const description = typeof record.description === "string" ? record.description : "";
  const assetId = primaryAssetId(collection, record);
  const idKey = collection === "campfireFuels" ? "logItemId" : collection === "spellRunes" ? "itemId" : undefined;
  const meta = useQuery({ queryKey: ["meta", collection, props.collectionShape === "object" ? "$collection" : id], queryFn: () => apiGet<MetaResponse>(`meta/${collection.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(props.collectionShape === "object" ? "$collection" : id)}`), enabled: !__DEVDOCS_PLAYER__ && !generated, staleTime: 10_000, refetchOnWindowFocus: false, retry: false });
  const status = meta.data?.data.status;
  const openRequests = meta.data?.data.notes.filter(note => note.request && note.request.state !== "closed").length ?? 0;
  const facts = summary.badges.filter(badge => !badge.tone || !["ok", "warn", "danger"].includes(badge.tone)).filter(badge => badge.text !== "Generated").map(badge => badge.text);
  async function copyId() { try { await navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); } }
  const select = (value: string) => { setTab(value); setVisited(previous => new Set(previous).add(value)); };

  return <article className="ws-page record">
    <div className="record-main">
      <header className="record-head">
        <Thumb spec={summary.thumb} size="l" alt="" />
        <div className="record-title">
          <h1 title={rowName(record)}>{summary.title}</h1>
          <Facts items={[
            labelFor(collection),
            summary.tier !== undefined && `Tier ${summary.tier}`,
            ...facts,
            <button key="id" className="id-copy" title="Copy record ID" onClick={() => void copyId()}><code>{id}</code>{copied ? <Check size={12} /> : <Copy size={12} />}</button>,
            status && status !== "draft" && <span className="badge" data-tone={status === "live" || status === "approved" ? "ok" : status === "rejected" ? "danger" : "warn"}>{titleCase(status)}</span>,
            openRequests > 0 && <span className="badge" data-tone="warn">{openRequests} open request{openRequests === 1 ? "" : "s"}</span>,
          ]} />
        </div>
        <div className="record-actions">
          {canEdit && props.collectionShape === "array" && RecordActions && <Suspense fallback={null}><RecordActions collection={collection} record={record} recordId={id} editable={canEdit} idKey={idKey} navigate={navigate} compact /></Suspense>}
        </div>
      </header>
      <Tabs.Root className="entity-tabs" value={tab} onValueChange={select}>
        <Tabs.List aria-label="Record detail" className="entity-tab-list">
          <Tabs.Trigger value="edit">{canEdit ? "Record" : "Fields"}</Tabs.Trigger>
          {canEdit && isBalance && <Tabs.Trigger value="formula">Formula</Tabs.Trigger>}
          {canEdit && collection === "equipmentSets" && <Tabs.Trigger value="pieces">Pieces</Tabs.Trigger>}
          {!__DEVDOCS_PLAYER__ && assetId && <Tabs.Trigger value="model">Model candidates</Tabs.Trigger>}
          {!__DEVDOCS_PLAYER__ && !generated && <Tabs.Trigger value="notes">Notes</Tabs.Trigger>}
          <Tabs.Trigger value="raw">JSON</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="edit" forceMount hidden={tab !== "edit"}>
          {description && !canEdit && <p className="entity-description" style={{ marginBottom: 12 }}>{description}</p>}
          {canEdit && EntityEditor ? <Suspense fallback={<p className="empty-inline">Loading editor…</p>}><EntityEditor collection={collection} recordId={id} /></Suspense> : <RecordFields collection={collection} record={record} />}
          <ReferencedBy collection={collection} id={id} navigate={navigate} />
        </Tabs.Content>
        {canEdit && isBalance && BalancePanel && visited.has("formula") && <Tabs.Content value="formula" forceMount hidden={tab !== "formula"}><Suspense fallback={<p className="empty-inline">Loading formula…</p>}><BalancePanel collection={collection} recordId={id} /></Suspense></Tabs.Content>}
        {canEdit && collection === "equipmentSets" && SetPiecePanel && visited.has("pieces") && <Tabs.Content value="pieces" forceMount hidden={tab !== "pieces"}><Suspense fallback={<p className="empty-inline">Loading pieces…</p>}><SetPiecePanel collection={collection} recordId={id} /></Suspense></Tabs.Content>}
        {!__DEVDOCS_PLAYER__ && assetId && AssetCandidates && visited.has("model") && <Tabs.Content value="model" forceMount hidden={tab !== "model"}><Suspense fallback={<p className="empty-inline">Loading candidates…</p>}><AssetCandidates collection={collection} entityId={id} currentAssetId={assetId} targetLabel={`Candidates for ${summary.title}`} /></Suspense></Tabs.Content>}
        {!__DEVDOCS_PLAYER__ && !generated && NotesPanel && visited.has("notes") && <Tabs.Content value="notes" forceMount hidden={tab !== "notes"}><Suspense fallback={<p className="empty-inline">Loading notes…</p>}><NotesPanel collection={collection} entityId={props.collectionShape === "object" ? "$collection" : id} /></Suspense></Tabs.Content>}
        <Tabs.Content value="raw"><pre className="record-source" style={{ padding: 0 }}>{JSON.stringify(record, null, 2)}</pre></Tabs.Content>
      </Tabs.Root>
    </div>
    <aside className="record-rail">
      <EntitySummary collection={collection} record={record} recordId={id} index={index} navigate={navigate} editing={canEdit} />
    </aside>
  </article>;
}

export default EntityDetail;
