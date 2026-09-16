import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Store } from "lucide-react";
import { shopSchema } from "../../../../game/src/content/schema/people.js";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { contentRows } from "../../model/rows.js";
import { Facts, Field, NumberField, ReferencedBy, Section, Sheet, TextField, fieldFromSchema } from "../../ui/field/index.js";
import { ErrorState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import { TileGrid, tileArtClasses, tileClasses, tileSubtitleClasses, tileTitleClasses } from "../../ui/RecordTile.js";
import type { ViewProps } from "../types.js";
import { asRecord, findStand, list, num, PageState, RecordShell, StackList, text, usePage, WhereBlock } from "./shared.js";
import { PAGE } from "../../ui/layout.js";

interface Shop extends ContentRow { id: string; name: string; buyMultiplier?: number; sellMultiplier?: number; stock?: ContentRow[] }

const shop = (key: string) => fieldFromSchema(shopSchema, key);

export default function ShopsView({ recordId, navigate }: ViewProps) {
  if (recordId === undefined) return <ShopList navigate={navigate} />;
  return <ShopPage id={recordId} navigate={navigate} />;
}

/* ---------- List ---------- */

function ShopList({ navigate }: { navigate: ViewProps["navigate"] }) {
  const query = useQuery(collectionQuery("shops"));
  const rows = useMemo(() => query.data ? contentRows(query.data) : [], [query.data]);
  if (query.isPending) return <div className={PAGE}><LoadingRows /></div>;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  return <div className={PAGE}>
    <TileGrid>{rows.map(row => {
      const id = String(row.id);
      const stock = list(row.stock).map(asRecord);
      const ids = stock.map(entry => text(entry.itemId) ?? "").filter(Boolean);
      return <div role="button" tabIndex={0} className={tileClasses()} key={id} onClick={() => navigate("shops", id)} onKeyDown={event => { if (event.key === "Enter") navigate("shops", id); }}>
        <span className={tileArtClasses()}><Thumb spec={ids.length ? { kind: "items", ids } : { kind: "glyph", icon: Store }} size="xl" alt="" /></span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className={tileTitleClasses()} title={`${String(row.name)} · ${id}`}>{String(row.name)}</span>
          <span className={tileSubtitleClasses()}><Facts items={[`buy ×${num(row.buyMultiplier) ?? 1}`, `sell ×${num(row.sellMultiplier) ?? 1}`, `${stock.length} line${stock.length === 1 ? "" : "s"}`]} /></span>
        </span>
      </div>;
    })}</TileGrid>
  </div>;
}

/* ---------- Record ---------- */

function ShopPage({ id, navigate }: { id: string; navigate: ViewProps["navigate"] }) {
  const page = usePage<Shop>("shops", id);
  const { draft, index } = page;
  const readOnly = !draft.editable;
  const stand = useMemo(() => findStand(index, "shops", id), [index, id]);
  return <PageState page={page} collection="shops" navigate={navigate}>{record => {
    const stock = list(record.stock).map(asRecord);
    const ids = stock.map(entry => text(entry.itemId) ?? "").filter(Boolean);
    return <RecordShell
      thumb={ids.length ? { kind: "items", ids } : { kind: "glyph", icon: Store }}
      title={record.name} id={id}
      facts={[stand && `${stand.regionName} · ${String(stand.settlement.name)}`, `buy ×${num(record.buyMultiplier) ?? 1}`, `sell ×${num(record.sellMultiplier) ?? 1}`]}
      draft={draft}
      rail={<WhereBlock id={id} stand={stand} detail={text(stand?.stand.shopKind) && `${String(stand?.stand.shopKind)} stand`} mapTarget={stand ? `shops:${stand.regionId}/${id}` : ""} empty="No settlement has a stand for this shop." navigate={navigate} />}>
      <Sheet>
        <Section title="Shop">
          <Field label={shop("name").label}><TextField value={record.name ?? ""} readOnly={readOnly} onChange={value => draft.setPath(["name"], value)} /></Field>
          <Field label={shop("buyMultiplier").label} hint={shop("buyMultiplier").hint}>
            <NumberField value={num(record.buyMultiplier)} min={shop("buyMultiplier").min ?? 0} step={0.05} unit="× value" width="short" readOnly={readOnly} ariaLabel={shop("buyMultiplier").label} onChange={value => draft.setPath(["buyMultiplier"], value)} />
          </Field>
          <Field label={shop("sellMultiplier").label} hint={shop("sellMultiplier").hint}>
            <NumberField value={num(record.sellMultiplier)} min={shop("sellMultiplier").min ?? 0} step={0.05} unit="× value" width="short" readOnly={readOnly} ariaLabel={shop("sellMultiplier").label} onChange={value => draft.setPath(["sellMultiplier"], value)} />
          </Field>
        </Section>

        <Section title={shop("stock").label}>
          <StackList label={shop("stock").label} bare items={stock} readOnly={readOnly} quantityMin={0} unique addLabel="Add stock line"
            onChange={next => draft.setPath(["stock"], next)} />
        </Section>

        <ReferencedBy collection="shops" id={id} navigate={navigate} />
      </Sheet>
    </RecordShell>;
  }}</PageState>;
}
