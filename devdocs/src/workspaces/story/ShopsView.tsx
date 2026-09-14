import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Store } from "lucide-react";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { contentRows } from "../../model/rows.js";
import { EntitySummary } from "../../ui/EntitySummary.js";
import { RecordPicker } from "../../ui/RecordPicker.js";
import { Facts, Row, Section, Sheet } from "../../ui/Sheet.js";
import { Thumb } from "../../ui/Thumb.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { AddButton, asRecord, findStand, list, num, NumberField, PageState, position, RecordShell, RemoveButton, text, TextField, usePage } from "./shared.js";

interface Shop extends ContentRow { id: string; name: string; buyMultiplier?: number; sellMultiplier?: number; stock?: { itemId: string; quantity: number }[] }

export default function ShopsView({ recordId, navigate }: ViewProps) {
  if (recordId === undefined) return <ShopList navigate={navigate} />;
  return <ShopPage id={recordId} navigate={navigate} />;
}

/* ---------- List ---------- */

function ShopList({ navigate }: { navigate: ViewProps["navigate"] }) {
  const query = useQuery(collectionQuery("shops"));
  const rows = useMemo(() => query.data ? contentRows(query.data) : [], [query.data]);
  if (query.isPending) return <div className="ws-page"><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  return <div className="ws-page">
    <div className="tile-grid" style={{ "--tile-min": "200px" } as React.CSSProperties}>{rows.map(row => {
      const id = String(row.id);
      const stock = list(row.stock).map(asRecord);
      const ids = stock.map(entry => text(entry.itemId) ?? "").filter(Boolean);
      return <div role="button" tabIndex={0} className="tile" key={id} onClick={() => navigate("shops", id)} onKeyDown={event => { if (event.key === "Enter") navigate("shops", id); }}>
        <span className="tile-art shop-tile-thumb"><Thumb spec={ids.length ? { kind: "items", ids } : { kind: "glyph", icon: Store }} size="xl" alt="" /></span>
        <span className="tile-body">
          <span className="tile-title" title={`${String(row.name)} · ${id}`}>{String(row.name)}</span>
          <span className="tile-subtitle"><Facts items={[`buy ×${num(row.buyMultiplier) ?? 1}`, `sell ×${num(row.sellMultiplier) ?? 1}`, `${stock.length} line${stock.length === 1 ? "" : "s"}`]} /></span>
        </span>
      </div>;
    })}</div>
  </div>;
}

/* ---------- Record ---------- */

function ShopPage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const page = usePage<Shop>("shops", id);
  const { draft, index, ctx } = page;
  const editable = draft.editable;
  const stand = useMemo(() => findStand(index, "shops", id), [index, id]);
  return <PageState page={page} collection="shops" navigate={navigate}>{(shop, record) => {
    const stock = list(shop.stock).map(asRecord);
    const ids = stock.map(entry => text(entry.itemId) ?? "").filter(Boolean);
    const point = position(stand?.stand.position);
    return <RecordShell
      thumb={ids.length ? { kind: "items", ids } : { kind: "glyph", icon: Store }}
      title={shop.name} id={id}
      facts={[stand && `${stand.regionName} · ${String(stand.settlement.name)}`, `buy ×${num(shop.buyMultiplier) ?? 1}`, `sell ×${num(shop.sellMultiplier) ?? 1}`]}
      draft={draft}
      rail={<EntitySummary collection="shops" record={record} recordId={id} index={index} navigate={navigate} editing />}>
      <Sheet>
        <Section title="Shop">
          <Row label="Name"><TextField editable={editable} value={shop.name} onChange={value => draft.setPath(["name"], value)} ariaLabel="Name" /></Row>
          <Row label="Buy multiplier" hint="Price the shop charges, as a multiple of item value"><NumberField editable={editable} value={num(shop.buyMultiplier)} onChange={value => draft.setPath(["buyMultiplier"], value)} unit="× value" min={0} step={0.05} ariaLabel="Buy multiplier" /></Row>
          <Row label="Sell multiplier" hint="Price the shop pays, as a multiple of item value"><NumberField editable={editable} value={num(shop.sellMultiplier)} onChange={value => draft.setPath(["sellMultiplier"], value)} unit="× value" min={0} step={0.05} ariaLabel="Sell multiplier" /></Row>
        </Section>
        <Section title="Stock" aside={editable && <RecordPicker collection={page.itemCollection} ctx={ctx} exclude={new Set(ids)} onPick={picked => draft.setPath(["stock", stock.length], { itemId: picked, quantity: 1 })} trigger={<AddButton label="Add item">Add item</AddButton>} />}>
          {stock.length
            ? <div className="shop-stock">{stock.map((entry, at) => {
              const itemId = text(entry.itemId) ?? "";
              const item = ctx.lookup("item", itemId);
              const name = item ? String(item.name ?? itemId) : itemId;
              return <div className="tile" key={`${itemId}:${at}`}>
                <span className="tile-art"><Thumb spec={{ kind: "item", id: itemId }} size="l" alt="" /></span>
                <span className="tile-body">
                  <button type="button" className="tile-title" title={itemId} onClick={() => navigate(page.itemCollection, itemId)}>{name}</button>
                  <span className="tile-qty">{editable
                    ? <><input type="number" min={1} step={1} value={num(entry.quantity) ?? ""} aria-label={`${name} quantity`} onChange={event => draft.setPath(["stock", at, "quantity"], event.target.value === "" ? undefined : Number(event.target.value))} /> in stock</>
                    : <span className="mono">×{num(entry.quantity) ?? 1}</span>}</span>
                </span>
                {editable && <RemoveButton label={`Remove ${name}`} onClick={() => draft.setPath(["stock"], stock.filter((_, index) => index !== at))} />}
              </div>;
            })}</div>
            : <span className="story-empty">Nothing in stock.</span>}
        </Section>
        <Section title="Where">
          {stand
            ? <div className="story-where">
              <Thumb spec={point ? { kind: "map", x: point.x, z: point.z, span: 80, icon: MapPin } : { kind: "glyph", icon: MapPin }} size="l" alt="" />
              <div className="story-where-text">
                <span>{stand.regionName} · {String(stand.settlement.name)}{text(stand.stand.shopKind) && <span className="muted"> · {String(stand.stand.shopKind)} stand</span>}{point && <span className="muted mono"> · {point.x}, {point.z}</span>}</span>
                <span><button type="button" className="text-button" onClick={() => navigate("world/map", `shops:${stand.regionId}/${id}`)}>Show on map</button></span>
              </div>
            </div>
            : <span className="story-empty">No settlement has a stand for this shop.</span>}
        </Section>
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}
