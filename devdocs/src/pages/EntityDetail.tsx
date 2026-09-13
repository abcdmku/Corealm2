import { Copy, Check, ChevronRight } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import type { AppProps, EntityDetailProps } from "../model/contracts.js";
import { rowName } from "../model/rows.js";
import { ItemIcon } from "../ui/ItemIcon.js";
import { iconFor, labelFor } from "../ui/library.js";
import { EntityModel, ItemConnections, viewerSource } from "./EntityExtras.js";
import * as Tabs from "@radix-ui/react-tabs";
const NotesPanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/NotesPanel.js"));
const EntityEditor = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/EntityEditor.js"));
const BalancePanel = __DEVDOCS_PLAYER__ ? undefined : lazy(() => import("../dev/BalancePanel.js"));

export function fieldLabel(key: string) { return key.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, c => c.toUpperCase()).replace(/\bXp\b/g, "XP").replace(/\bId\b/g, "ID"); }
export function compactValue(value: unknown): string {
  if (value === undefined || value === null) return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 5 });
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length ? value.every(v => typeof v !== "object") ? value.join(", ") : `${value.length} entries` : "None";
  return `${Object.keys(value as object).length} fields`;
}
export function ValueView({ value, name = "", navigate, depth = 0 }: { value: unknown; name?: string; navigate?: AppProps["navigate"]; depth?: number }) {
  if (value === null || value === undefined) return <span className="muted">Not set</span>;
  if (typeof value !== "object") {
    if (typeof value === "string" && navigate && ["itemId", "outputItemId", "yieldItemId"].includes(name)) return <button className="reference-link" onClick={() => navigate("items", value)}>{value}<ChevronRight size={13}/></button>;
    return <span className={typeof value === "number" ? "numeric-value" : undefined}>{compactValue(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="muted">None</span>;
    if (value.every(v => typeof v !== "object")) return <div className="value-tags">{value.map((v, i) => <span className="value-tag" key={i}>{compactValue(v)}</span>)}</div>;
    return <div className="value-list">{value.map((entry, index) => <div className="value-list-entry" key={index}><span className="entry-number">{index + 1}</span><ValueView value={entry} navigate={navigate} depth={depth + 1}/></div>)}</div>;
  }
  return <dl className={`field-list${depth ? " nested-fields" : ""}`}>{Object.entries(value).map(([key, entry]) => <div className="field-row" key={key}><dt>{fieldLabel(key)}</dt><dd><ValueView value={entry} name={key} navigate={navigate} depth={depth + 1}/></dd></div>)}</dl>;
}

export function EntityDetail(props: EntityDetailProps) {
  const { collection, record, navigate } = props;
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState("overview");
  const [visited, setVisited] = useState(() => new Set(["overview"]));
  const name = rowName(record, record.id === undefined && record.itemId ? "itemId" : record.id === undefined && record.tier !== undefined ? "tier" : "id");
  const id = props.recordId ?? String(record.id ?? record.itemId ?? record.logItemId ?? record.tier ?? "");
  const canEdit = !__DEVDOCS_PLAYER__ && props.editable;
  const Icon = iconFor(collection);
  const fields = Object.fromEntries(Object.entries(record).filter(([key]) => !["id", "name", "title", "description", "catalog"].includes(key)));
  const description = typeof record.description === "string" ? record.description : "";
  const hasModel = Boolean(viewerSource(props));
  async function copyId() { try { await navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } }
  return <article className="entity-detail">
    <header className="entity-header"><div className="entity-heading">
      {collection === "items" ? <ItemIcon key={id} id={id} name="" large/> : <span className="entity-symbol"><Icon size={32}/></span>}
      <div><div className="eyebrow">{labelFor(collection)}{record.tier !== undefined && <> / Tier {String(record.tier)}</>}</div>
        <h1>{name}</h1><button className="id-copy" title="Copy record ID" onClick={() => void copyId()}><code>{id}</code>{copied ? <Check size={13}/> : <Copy size={13}/>}</button>
      </div></div>{description && <p className="entity-description">{description}</p>}
    </header>
    <Tabs.Root className="entity-tabs" value={tab} onValueChange={value => { setTab(value); setVisited(previous => new Set(previous).add(value)); }}>
      <Tabs.List aria-label="Record detail" className="entity-tab-list">
        <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
        {hasModel && <Tabs.Trigger value="model">3D model</Tabs.Trigger>}
        {collection === "items" && <Tabs.Trigger value="connections">Sources and uses</Tabs.Trigger>}
        <Tabs.Trigger value="source">Source data</Tabs.Trigger>
        {canEdit && <Tabs.Trigger value="edit">Edit</Tabs.Trigger>}
        {canEdit && collection.startsWith("balance/") && <Tabs.Trigger value="formula">Formula</Tabs.Trigger>}
        {canEdit && <Tabs.Trigger value="notes">Notes</Tabs.Trigger>}
      </Tabs.List>
      <div className="detail-body">
        <Tabs.Content value="overview"><section className="detail-section"><div className="section-heading"><h2>{collection.startsWith("balance/") ? "Parameters" : "Overview"}</h2><span>{Object.keys(fields).length} fields</span></div><ValueView value={fields} navigate={navigate}/></section></Tabs.Content>
        {hasModel && <Tabs.Content value="model"><EntityModel {...props}/></Tabs.Content>}
        {collection === "items" && <Tabs.Content value="connections"><ItemConnections {...props}/></Tabs.Content>}
        <Tabs.Content value="source"><pre className="record-source">{JSON.stringify(record, null, 2)}</pre></Tabs.Content>
        {canEdit && EntityEditor && visited.has("edit") && <Tabs.Content value="edit" forceMount hidden={tab !== "edit"}><Suspense fallback={<p>Loading editor...</p>}><EntityEditor collection={collection} recordId={id}/></Suspense></Tabs.Content>}
        {canEdit && NotesPanel && visited.has("notes") && <Tabs.Content value="notes" forceMount hidden={tab !== "notes"}><Suspense fallback={<p>Loading notes...</p>}><NotesPanel collection={collection} entityId={props.collectionShape === "object" ? "$collection" : id}/></Suspense></Tabs.Content>}
        {canEdit && BalancePanel && collection.startsWith("balance/") && visited.has("formula") && <Tabs.Content value="formula" forceMount hidden={tab !== "formula"}><Suspense fallback={<p>Loading formula...</p>}><BalancePanel collection={collection} recordId={id}/></Suspense></Tabs.Content>}
      </div>
    </Tabs.Root>
  </article>;
}
export default EntityDetail;
