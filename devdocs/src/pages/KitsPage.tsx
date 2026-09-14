import { useMemo, useState } from "react";
import { Search, Shirt, Sparkles, Swords, Wrench, X, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { collectionQuery } from "../api/client.js";
import type { AppProps, ContentRow } from "../model/contracts.js";
import { contentRows } from "../model/rows.js";
import { noContext, summarize, type RecordSummary } from "../model/summaries.js";
import { EmptyState, ErrorState, LoadingRows } from "../ui/States.js";
import { RecordTile } from "../ui/RecordTile.js";
import { Thumb } from "../ui/Thumb.js";
import "./kits.css";

type KitFamily = "melee" | "magic" | "tools";
type KitKind = "dagger" | "sword" | "shield" | "staff" | "wand" | "pickaxe" | "hatchet" | "rod";

interface KitItem {
  id: string;
  name: string;
  tier: number;
  kind: KitKind;
  row: ContentRow;
}

interface ArmorSet {
  id: string;
  name: string;
  tier: number;
  style: "melee" | "magic" | string;
  members: Readonly<Record<string, string>>;
  row: ContentRow;
}

interface KitsPageProps {
  navigate?: AppProps["navigate"];
}

const noopNavigate: AppProps["navigate"] = () => undefined;
const ARMOR_SLOTS = ["head", "body", "legs", "hands", "feet"] as const;
const FAMILY_ORDER: readonly KitFamily[] = ["melee", "magic", "tools"];
const FAMILY_KINDS: Readonly<Record<KitFamily, readonly KitKind[]>> = {
  melee: ["dagger", "sword", "shield"],
  magic: ["wand", "staff"],
  tools: ["pickaxe", "hatchet", "rod"],
};
const KIND_LABELS: Readonly<Record<KitKind, string>> = {
  dagger: "Dagger", sword: "Sword", shield: "Shield", staff: "Staff", wand: "Wand",
  pickaxe: "Pickaxe", hatchet: "Hatchet", rod: "Rod",
};
const FAMILY_LABELS: Readonly<Record<KitFamily, string>> = {
  melee: "Melee", magic: "Magic", tools: "Tools",
};
const FAMILY_ICONS: Readonly<Record<KitFamily, LucideIcon>> = { melee: Swords, magic: Sparkles, tools: Wrench };

function record(value: unknown): ContentRow | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ContentRow
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function positiveTier(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function sourceId(row: ContentRow): string {
  return text(row.id) ?? "";
}

function sourceName(row: ContentRow, id: string): string {
  return text(row.name) ?? text(row.title) ?? (id || "Unnamed record");
}

function derivationRole(row: ContentRow): string {
  const derivation = record(row.derivation);
  return text(derivation?.role)?.toLowerCase() ?? "";
}

function kitKind(row: ContentRow): KitKind | undefined {
  const id = sourceId(row).toLowerCase();
  const name = (text(row.name) ?? "").toLowerCase();
  const role = derivationRole(row);
  const words = `${id} ${name} ${role}`;
  const category = text(row.category)?.toLowerCase();
  const equip = record(row.equip);
  const equipSlot = text(equip?.slot);
  const magicWeapon = record(row.magicWeapon);
  const magicKind = text(magicWeapon?.kind);
  if (category === "equipment" && equipSlot === "mainHand") {
    if (magicKind === "staff" || magicKind === "wand") return magicKind;
    if (words.includes("dagger")) return "dagger";
    if (words.includes("sword") || words.includes("shortsword")) return "sword";
  }
  if (category === "equipment" && equipSlot === "offHand" && (words.includes("shield") || words.includes("guard"))) return "shield";
  if (category === "tool") {
    const toolSkill = text(record(row.tool)?.skill)?.toLowerCase();
    if (toolSkill === "mining" || words.includes("pickaxe")) return "pickaxe";
    if (toolSkill === "woodcutting" || words.includes("hatchet")) return "hatchet";
    if (toolSkill === "fishing" || words.includes("rod")) return "rod";
  }
  return undefined;
}

function kitFamily(kind: KitKind): KitFamily {
  return kind === "pickaxe" || kind === "hatchet" || kind === "rod" ? "tools" : kind === "staff" || kind === "wand" ? "magic" : "melee";
}

function itemRecords(rows: readonly ContentRow[]): KitItem[] {
  return rows.flatMap((row): KitItem[] => {
    const id = sourceId(row);
    const tier = positiveTier(row.tier);
    const kind = kitKind(row);
    if (!id || tier === undefined || kind === undefined) return [];
    return [{ id, name: sourceName(row, id), tier, kind, row }];
  });
}

function armorRecords(rows: readonly ContentRow[]): ArmorSet[] {
  return rows.flatMap((row): ArmorSet[] => {
    const id = sourceId(row);
    const tier = positiveTier(row.tier);
    const members = record(row.members);
    if (!id || tier === undefined || !members) return [];
    const normalized = Object.fromEntries(Object.entries(members).flatMap(([slot, member]) => {
      const itemId = text(member);
      return itemId ? [[slot, itemId] as const] : [];
    }));
    return [{
      id,
      name: sourceName(row, id),
      tier,
      style: text(row.style) ?? "unknown",
      members: normalized,
      row,
    }];
  });
}

function formatTier(tier: number): string {
  return Number.isInteger(tier) ? String(tier) : String(Number(tier.toFixed(2)));
}

function formatSearchValues(item: KitItem): string {
  return `${item.id} ${item.name} ${item.kind} ${item.tier}`.toLowerCase();
}

function setSearchValues(set: ArmorSet, itemsById: ReadonlyMap<string, ContentRow>): string {
  const memberNames = Object.values(set.members).map((id) => text(itemsById.get(id)?.name) ?? id).join(" ");
  return `${set.id} ${set.name} ${set.style} ${set.tier} ${memberNames}`.toLowerCase();
}

/** A kit item's summary with its kind as the leading badge, so the ladder reads by role. */
function kitSummary(item: KitItem): RecordSummary {
  const summary = summarize("items", item.row, noContext);
  return { ...summary, badges: [{ text: KIND_LABELS[item.kind], tone: "info" }, ...summary.badges.filter(badge => badge.text !== KIND_LABELS[item.kind]).slice(0, 1)] };
}

export function KitsPage({ navigate = noopNavigate }: KitsPageProps = {}) {
  const itemsQuery = useQuery(collectionQuery("items"));
  const setsQuery = useQuery(collectionQuery("equipmentSets"));
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | number>("all");
  const [familyFilter, setFamilyFilter] = useState<"all" | KitFamily>("all");

  const items = useMemo(() => itemsQuery.data ? contentRows(itemsQuery.data) : [], [itemsQuery.data]);
  const sets = useMemo(() => setsQuery.data ? contentRows(setsQuery.data) : [], [setsQuery.data]);
  const kitItems = useMemo(() => itemRecords(items), [items]);
  const armorSets = useMemo(() => armorRecords(sets), [sets]);
  const itemsById = useMemo(() => new Map(items.flatMap((row) => {
    const id = sourceId(row);
    return id ? [[id, row] as const] : [];
  })), [items]);
  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return kitItems.filter((item) => (!needle || formatSearchValues(item).includes(needle)) && (familyFilter === "all" || kitFamily(item.kind) === familyFilter));
  }, [kitItems, search, familyFilter]);
  const filteredSets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return armorSets.filter((set) => !needle || setSearchValues(set, itemsById).includes(needle));
  }, [armorSets, itemsById, search]);
  const tiers = useMemo(() => [...new Set([...filteredItems.map((item) => item.tier), ...filteredSets.map((set) => set.tier)])].sort((a, b) => a - b), [filteredItems, filteredSets]);
  const allTiers = useMemo(() => [...new Set([...kitItems.map((item) => item.tier), ...armorSets.map((set) => set.tier)])].sort((a, b) => a - b), [kitItems, armorSets]);
  const visibleTiers = useMemo(() => tierFilter === "all" ? tiers : tiers.filter((tier) => tier === tierFilter), [tierFilter, tiers]);

  if (itemsQuery.isPending || setsQuery.isPending) {
    return <div className="kits-page"><KitsHeading itemCount={0} setCount={0} /><LoadingRows /></div>;
  }
  if (itemsQuery.isError || setsQuery.isError) {
    const message = itemsQuery.error?.message ?? setsQuery.error?.message ?? "The item and armor-set collections could not be loaded.";
    return <div className="kits-page"><KitsHeading itemCount={0} setCount={0} /><ErrorState message={message} retry={() => { void itemsQuery.refetch(); void setsQuery.refetch(); }} /></div>;
  }

  return <div className="kits-page">
    <KitsHeading itemCount={kitItems.length} setCount={armorSets.length} />
    <div className="browser-toolbar" aria-label="Filter kits">
      <label className="search-field kits-search">
        <Search size={14} />
        <span className="sr-only">Search kits</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search items, sets, or tiers…" aria-label="Search kits" />
        {search ? <button type="button" className="icon-button" aria-label="Clear kit search" onClick={() => setSearch("")}><X size={13} /></button> : <kbd>/</kbd>}
      </label>
      <span className="result-count" aria-live="polite">{visibleTiers.length ? `${visibleTiers.length} tier${visibleTiers.length === 1 ? "" : "s"}` : "No matches"}</span>
      {(search || tierFilter !== "all" || familyFilter !== "all") && <button type="button" className="text-button" onClick={() => { setSearch(""); setTierFilter("all"); setFamilyFilter("all"); }}>Clear filters</button>}
    </div>
    <div className="facets">
      <div className="facet" role="group" aria-label="Filter by tier">
        <span>Tier</span>
        <button type="button" className={`filter-chip${tierFilter === "all" ? " is-active" : ""}`} aria-pressed={tierFilter === "all"} onClick={() => setTierFilter("all")}>All</button>
        {allTiers.map((tier) => <button type="button" className={`filter-chip${tierFilter === tier ? " is-active" : ""}`} aria-pressed={tierFilter === tier} onClick={() => setTierFilter(tier)} key={tier}>{formatTier(tier)}<small>{kitItems.filter(item => item.tier === tier).length}</small></button>)}
      </div>
      <div className="facet" role="group" aria-label="Filter by family">
        <span>Family</span>
        <button type="button" className={`filter-chip${familyFilter === "all" ? " is-active" : ""}`} aria-pressed={familyFilter === "all"} onClick={() => setFamilyFilter("all")}>All</button>
        {FAMILY_ORDER.map((family) => { const Icon = FAMILY_ICONS[family]; return <button type="button" className={`filter-chip${familyFilter === family ? " is-active" : ""}`} aria-pressed={familyFilter === family} onClick={() => setFamilyFilter(family)} key={family}><Icon size={12} />{FAMILY_LABELS[family]}</button>; })}
      </div>
    </div>

    {!visibleTiers.length ? <EmptyState title={search || tierFilter !== "all" || familyFilter !== "all" ? "No kits match these filters" : "No kit records are available"}>Try another item, set, or tier.</EmptyState> : <div className="kits-ladder">
      {visibleTiers.map((tier) => <TierSection
        key={tier}
        tier={tier}
        items={filteredItems.filter((item) => item.tier === tier)}
        catalogItems={kitItems.filter((item) => item.tier === tier)}
        sets={filteredSets.filter((set) => set.tier === tier)}
        families={familyFilter === "all" ? FAMILY_ORDER : [familyFilter]}
        itemsById={itemsById}
        navigate={navigate}
      />)}
    </div>}
  </div>;
}

function KitsHeading({ itemCount, setCount }: { itemCount: number; setCount: number }) {
  return <div className="page-heading">
    <h1>Kits</h1>
    <span className="badge">{itemCount} items</span>
    <span className="badge">{setCount} armor sets</span>
  </div>;
}

function TierSection({
  tier,
  items,
  catalogItems,
  sets,
  families,
  itemsById,
  navigate,
}: {
  tier: number;
  items: readonly KitItem[];
  catalogItems: readonly KitItem[];
  sets: readonly ArmorSet[];
  families: readonly KitFamily[];
  itemsById: ReadonlyMap<string, ContentRow>;
  navigate: AppProps["navigate"];
}) {
  return <section className="kits-tier" aria-labelledby={`kits-tier-${tier}`}>
    <div className="group-heading"><span id={`kits-tier-${tier}`}>Tier {formatTier(tier)}</span><small>{items.length} items · {sets.length} {sets.length === 1 ? "set" : "sets"}</small></div>
    <div className="tile-grid kits-item-grid" data-density="compact">
      {families.flatMap((family) => FAMILY_KINDS[family].flatMap((kind) => {
        const matching = items.filter((item) => item.kind === kind);
        if (matching.length) return matching.map((item) => <RecordTile key={item.id} collection="items" id={item.id} summary={kitSummary(item)} mode="grid" onOpen={(id) => navigate("items", id)} hoverCard />);
        const cataloged = catalogItems.some((item) => item.kind === kind);
        return [<div className="kit-missing" key={`missing-${kind}`} title={cataloged ? "Hidden by the current search" : "Nothing in this tier"}><span className="kit-missing-art">—</span><span className="kit-missing-copy"><span className="tile-title">{KIND_LABELS[kind]}</span><span className="tile-subtitle">{cataloged ? "Hidden by search" : "Not cataloged"}</span></span></div>];
      }))}
    </div>
    {sets.length > 0 && <div className="kits-sets">{sets.map((set) => <ArmorSetCard key={set.id} set={set} itemsById={itemsById} navigate={navigate} />)}</div>}
  </section>;
}

function ArmorSetCard({ set, itemsById, navigate }: { set: ArmorSet; itemsById: ReadonlyMap<string, ContentRow>; navigate: AppProps["navigate"] }) {
  const summary = summarize("equipmentSets", set.row, noContext);
  return <article className="panel kits-set">
    <header className="panel-header kits-set-header">
      <button type="button" className="kits-set-link" onClick={() => navigate("equipmentSets", set.id)} title={`Equipment sets · ${set.id}`}><Thumb spec={summary.thumb} size="s" /><span className="kits-set-name">{set.name}</span></button>
      <span className="badge" data-tone="info">{set.style}</span>
      <span className="count-badge">{Object.keys(set.members).length} pieces</span>
    </header>
    <div className="slot-grid kits-set-slots">
      {ARMOR_SLOTS.map((slot) => {
        const itemId = set.members[slot];
        const item = itemId ? itemsById.get(itemId) : undefined;
        const itemName = item && itemId ? sourceName(item, itemId) : itemId;
        return itemId && item
          ? <button type="button" className="slot-tile" key={slot} onClick={() => navigate("items", itemId)} aria-label={`Open ${itemName}`} title={`${itemName} · ${itemId}`}><Thumb spec={{ kind: "item", id: itemId }} size="l" /><small>{slot}</small><strong>{itemName}</strong></button>
          : <div className="slot-tile is-empty" key={slot}><Thumb spec={{ kind: "glyph", icon: Shirt }} size="l" /><small>{slot}</small><strong>{itemId ? `Uncatalogued ${itemId}` : "Missing"}</strong></div>;
      })}
    </div>
  </article>;
}

export default KitsPage;
