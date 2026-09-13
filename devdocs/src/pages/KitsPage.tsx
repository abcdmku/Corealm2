import { useId, useMemo, useState } from "react";
import { ArrowUpRight, Search, Shield, Sparkles, Swords, Wrench, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { collectionQuery } from "../api/client.js";
import type { AppProps, ContentRow } from "../model/contracts.js";
import { contentRows } from "../model/rows.js";
import { EmptyState, ErrorState, LoadingRows } from "../ui/States.js";
import { ItemIcon } from "../ui/ItemIcon.js";
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
  melee: "Melee kit", magic: "Magic kit", tools: "Gathering tools",
};

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

function formatRequirement(row: ContentRow): string | undefined {
  const equip = record(row.equip);
  const requires = record(equip?.requires);
  if (!requires) return undefined;
  const entries = Object.entries(requires).filter(([, value]) => typeof value === "number" && Number.isFinite(value));
  if (!entries.length) return undefined;
  return entries.map(([skill, level]) => `${skill} ${String(level)}`).join(" · ");
}

function formatSearchValues(item: KitItem): string {
  return `${item.id} ${item.name} ${item.kind} ${item.tier}`.toLowerCase();
}

function setSearchValues(set: ArmorSet, itemsById: ReadonlyMap<string, ContentRow>): string {
  const memberNames = Object.values(set.members).map((id) => text(itemsById.get(id)?.name) ?? id).join(" ");
  return `${set.id} ${set.name} ${set.style} ${set.tier} ${memberNames}`.toLowerCase();
}

function familyIcon(family: KitFamily) {
  return family === "melee" ? Swords : family === "magic" ? Sparkles : Wrench;
}

function itemKinds(family: KitFamily): readonly KitKind[] {
  return FAMILY_KINDS[family];
}

export function KitsPage({ navigate = noopNavigate }: KitsPageProps = {}) {
  const itemsQuery = useQuery(collectionQuery("items"));
  const setsQuery = useQuery(collectionQuery("equipmentSets"));
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | number>("all");

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
    return kitItems.filter((item) => !needle || formatSearchValues(item).includes(needle));
  }, [kitItems, search]);
  const filteredSets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return armorSets.filter((set) => !needle || setSearchValues(set, itemsById).includes(needle));
  }, [armorSets, itemsById, search]);
  const tiers = useMemo(() => [...new Set([...filteredItems.map((item) => item.tier), ...filteredSets.map((set) => set.tier)])].sort((a, b) => a - b), [filteredItems, filteredSets]);
  const visibleTiers = useMemo(() => tierFilter === "all" ? tiers : tiers.filter((tier) => tier === tierFilter), [tierFilter, tiers]);
  const totalKitItems = kitItems.length;
  const totalSets = armorSets.length;

  if (itemsQuery.isPending || setsQuery.isPending) {
    return <div className="kits-page"><KitsIntro itemCount={0} setCount={0}/><LoadingRows/></div>;
  }
  if (itemsQuery.isError || setsQuery.isError) {
    const message = itemsQuery.error?.message ?? setsQuery.error?.message ?? "The item and armor-set collections could not be loaded.";
    return <div className="kits-page"><KitsIntro itemCount={0} setCount={0}/><ErrorState message={message} retry={() => { void itemsQuery.refetch(); void setsQuery.refetch(); }}/></div>;
  }

  return <div className="kits-page">
    <KitsIntro itemCount={totalKitItems} setCount={totalSets}/>
    <div className="kits-controls" aria-label="Filter kits">
      <label className="kits-search">
        <Search size={16}/>
        <span className="sr-only">Search kits</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search items, sets, or tiers…" aria-label="Search kits"/>
        {search ? <button type="button" aria-label="Clear kit search" onClick={() => setSearch("")}><X size={14}/></button> : <kbd>/</kbd>}
      </label>
      <div className="kits-tiers" role="group" aria-label="Filter by tier">
        <span className="kits-filter-label">Tier</span>
        <button type="button" className={tierFilter === "all" ? "is-active" : ""} aria-pressed={tierFilter === "all"} onClick={() => setTierFilter("all")}>All</button>
        {tiers.map((tier) => <button type="button" className={tierFilter === tier ? "is-active" : ""} aria-pressed={tierFilter === tier} onClick={() => setTierFilter(tier)} key={tier}>{formatTier(tier)}</button>)}
      </div>
      <span className="kits-result-count" aria-live="polite">{visibleTiers.length ? `${visibleTiers.length} tier${visibleTiers.length === 1 ? "" : "s"}` : "No matches"}</span>
    </div>

    {!visibleTiers.length ? <EmptyState title={search || tierFilter !== "all" ? "No kits match these filters" : "No kit records are available"}>Try another item, set, or tier.</EmptyState> : <div className="kits-ladder">
      {visibleTiers.map((tier) => <TierSection
        key={tier}
        tier={tier}
        items={filteredItems.filter((item) => item.tier === tier)}
        catalogItems={kitItems.filter((item) => item.tier === tier)}
        sets={filteredSets.filter((set) => set.tier === tier)}
        itemsById={itemsById}
        navigate={navigate}
      />)}
    </div>}
  </div>;
}

function KitsIntro({ itemCount, setCount }: { itemCount: number; setCount: number }) {
  return <header className="kits-intro">
    <div>
      <span className="kits-eyebrow"><Shield size={14}/> Equipment ladder</span>
      <h1>Kits</h1>
      <p>Weapons, gathering tools, and armor sets by tier.</p>
    </div>
    <dl className="kits-summary" aria-label="Kit totals">
      <div><dt>Items</dt><dd>{itemCount}</dd></div>
      <div><dt>Armor sets</dt><dd>{setCount}</dd></div>
    </dl>
  </header>;
}

function TierSection({
  tier,
  items,
  catalogItems,
  sets,
  itemsById,
  navigate,
}: {
  tier: number;
  items: readonly KitItem[];
  catalogItems: readonly KitItem[];
  sets: readonly ArmorSet[];
  itemsById: ReadonlyMap<string, ContentRow>;
  navigate: AppProps["navigate"];
}) {
  return <section className="kits-tier" aria-labelledby={`kits-tier-${tier}`}>
    <div className="kits-tier-heading">
      <span className="kits-tier-number">{formatTier(tier)}</span>
      <div><h2 id={`kits-tier-${tier}`}>Tier {formatTier(tier)}</h2><p>{sets.length ? `${sets.length} armor set${sets.length === 1 ? "" : "s"}` : "No armor set cataloged"}</p></div>
    </div>
    <div className="kits-tier-content">
      <div className="kit-families">
        {FAMILY_ORDER.map((family) => <KitFamilySection key={family} family={family} items={items} catalogItems={catalogItems} navigate={navigate}/>) }
      </div>
      <ArmorSetsSection sets={sets} itemsById={itemsById} navigate={navigate}/>
    </div>
  </section>;
}

function KitFamilySection({ family, items, catalogItems, navigate }: { family: KitFamily; items: readonly KitItem[]; catalogItems: readonly KitItem[]; navigate: AppProps["navigate"] }) {
  const Icon = familyIcon(family);
  const heading = useId();
  return <section className="kit-family" aria-labelledby={heading}>
    <header className="kit-family-heading"><span className="kit-family-icon"><Icon size={16}/></span><div><h3 id={heading}>{FAMILY_LABELS[family]}</h3><p>{family === "tools" ? "Tools for mining, woodcutting, and fishing." : family === "magic" ? "Wands and staffs from the magic ladder." : "Close combat weapons and shields."}</p></div></header>
    <div className="kit-slots">
      {itemKinds(family).flatMap((kind) => {
        const matching = items.filter((item) => item.kind === kind);
        if (matching.length) return matching.map((item) => <KitItemTile item={item} key={item.id} navigate={navigate}/>);
        const cataloged = catalogItems.some((item) => item.kind === kind);
        return [<div className="kit-missing" key={`missing-${kind}`}><span>—</span><div><strong>{cataloged ? `No matching ${KIND_LABELS[kind].toLowerCase()}` : `No ${KIND_LABELS[kind].toLowerCase()} cataloged`}</strong><small>{cataloged ? "Hidden by the current search" : "Nothing in this tier"}</small></div></div>];
      })}
    </div>
  </section>;
}

function KitItemTile({ item, navigate }: { item: KitItem; navigate: AppProps["navigate"] }) {
  const requirement = formatRequirement(item.row);
  return <button type="button" className="kit-item-tile" onClick={() => navigate("items", item.id)} aria-label={`Open ${item.name}`}>
    <ItemIcon id={item.id} name={item.name} large/>
    <span className="kit-item-copy"><strong>{item.name}</strong><code>{item.id}</code><small>{requirement ?? `Tier ${formatTier(item.tier)}`}</small></span>
    <ArrowUpRight className="kit-item-arrow" size={14}/>
  </button>;
}

function ArmorSetsSection({ sets, itemsById, navigate }: { sets: readonly ArmorSet[]; itemsById: ReadonlyMap<string, ContentRow>; navigate: AppProps["navigate"] }) {
  const heading = useId();
  return <section className="armor-sets" aria-labelledby={heading}>
    <header className="armor-sets-heading"><div><span className="kits-section-kicker">Armor</span><h3 id={heading}>Sets by style</h3></div><span>{sets.length ? `${sets.length} linked` : "No cataloged set"}</span></header>
    {sets.length ? <div className="armor-set-grid">{sets.map((set) => <ArmorSetCard key={set.id} set={set} itemsById={itemsById} navigate={navigate}/>)}</div> : <p className="armor-empty">No armor set is assigned to this tier.</p>}
  </section>;
}

function ArmorSetCard({ set, itemsById, navigate }: { set: ArmorSet; itemsById: ReadonlyMap<string, ContentRow>; navigate: AppProps["navigate"] }) {
  return <article className="armor-set-card">
    <header className="armor-set-card-heading"><button type="button" className="armor-set-link" onClick={() => navigate("equipmentSets", set.id)}><strong>{set.name}</strong><code>{set.id}</code></button><span className={`set-style set-style-${set.style}`}>{set.style}</span></header>
    <div className="armor-slots">
      {ARMOR_SLOTS.map((slot) => {
        const itemId = set.members[slot];
        const item = itemId ? itemsById.get(itemId) : undefined;
        const itemName = item && itemId ? sourceName(item, itemId) : itemId;
        return itemId && item ? <button type="button" className="armor-slot" key={slot} onClick={() => navigate("items", itemId)} aria-label={`Open ${itemName}`}><ItemIcon id={itemId} name={itemName}/><span><small>{slot}</small><strong>{itemName}</strong></span></button>
          : <div className="armor-slot armor-slot-missing" key={slot}><span className="armor-slot-empty">—</span><span><small>{slot}</small><strong>{itemId ? `Uncatalogued ${itemId}` : `Missing ${slot}`}</strong></span></div>;
      })}
    </div>
  </article>;
}

export default KitsPage;
