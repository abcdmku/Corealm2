import { lazy, Suspense } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { collectionQuery, collectionsQuery } from "../api/client.js";
import type { EntityDetailProps } from "../model/contracts.js";
import { sourceUses } from "../model/joins.js";
import type { CollectionResponse } from "../../shared/contracts.js";
import type { ViewerSource } from "../viewer/types.js";

const AssetViewer = lazy(() => import("../viewer/AssetViewer.js").then(module => ({ default: module.AssetViewer })));
const JOIN_COLLECTIONS = ["items", "compiled-items", "recipes", "compiled-recipes", "resources", "compiled-resources", "equipmentSets", "shops", "quests", "enemies", "creatures", "enemyAliases", "lootTables"];
export function viewerSource({ collection, record }: EntityDetailProps): ViewerSource | undefined {
  if (collection === "equipmentSets") return { mode: "outfit", itemIds: Object.values(record.members as Record<string, string>) };
  if (collection === "items" || collection === "compiled-items") {
    const equip = record.equip as { slot?: string } | undefined;
    const id = String(record.id);
    if (equip?.slot === "mainHand" || record.tool) return { mode: "outfit", itemIds: [], mainHandId: id };
    if (equip?.slot === "offHand") return { mode: "outfit", itemIds: [], offHandId: id };
    if (equip?.slot && ["head", "body", "legs", "feet", "hands"].includes(equip.slot)) return { mode: "outfit", itemIds: [id] };
  }
  if (["creatures", "enemies"].includes(collection) && typeof record.assetId === "string") return { mode: "creature", assetId: record.assetId };
  const presentation = record.presentation as { assetId?: unknown } | undefined;
  if (collection === "creatureDefinitions" && typeof presentation?.assetId === "string") return { mode: "creature", assetId: presentation.assetId };
  if (collection === "assets") return { mode: "asset", assetId: String(record.id) };
  return undefined;
}

export function ItemConnections({ record, navigate }: EntityDetailProps) {
  const summaries = useQuery(collectionsQuery());
  const available = new Set(summaries.data?.map(row => row.name));
  const names = JOIN_COLLECTIONS.filter(name => available.has(name));
  const queries = useQueries({ queries: names.map(collectionQuery) });
  const data = queries.flatMap(query => query.data ? [query.data] : []) as CollectionResponse[];
  const result = sourceUses(String(record.id), data);
  const failures = queries.filter(query => query.error);
  return <section className="detail-section"><div className="section-heading"><h2>Sources and uses</h2><span>{result.links.length} connections</span></div>
    {queries.some(query => query.isPending) && <p role="status">Loading connections…</p>}
    {failures.length > 0 && <p role="alert">Some connections could not be loaded. <button onClick={() => failures.forEach(query => void query.refetch())}>Retry</button></p>}
    {result.links.length ? <ul className="connection-list">{result.links.map((link, index) => <li key={`${link.collection}:${link.recordId}:${link.kind}:${index}`}>
      <button className="reference-link" disabled={!link.targetKnown} onClick={() => navigate(link.collection, link.recordId)}>{link.recordLabel}</button>
      <span className="muted">{link.kind.replaceAll("-", " ")} · {link.detail}</span>
    </li>)}</ul> : !queries.some(query => query.isPending) && <p className="muted">No sources or uses are listed in the loaded collections.</p>}
  </section>;
}

export function EntityExtras(props: EntityDetailProps) {
  const source = viewerSource(props);
  return <>{source && <section className="detail-section"><Suspense fallback={<p role="status">Loading 3D viewer…</p>}><AssetViewer source={source} label={String(props.record.name ?? "Model")}/></Suspense></section>}
    {(props.collection === "items" || props.collection === "compiled-items") && <ItemConnections {...props}/>}</>;
}

export function EntityModel(props: EntityDetailProps) {
  const source = viewerSource(props);
  return source ? <Suspense fallback={<p role="status">Loading 3D viewer…</p>}><AssetViewer source={source} label={String(props.record.name ?? "Model")}/></Suspense> : null;
}
