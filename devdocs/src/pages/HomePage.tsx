import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen } from "lucide-react";
import type { AppProps } from "../model/contracts.js";
import type { CollectionSummary } from "../../shared/contracts.js";
import { collectionQuery } from "../api/client.js";
import { contentRows, rowId, rowName } from "../model/rows.js";
import { descriptions, iconFor, labelFor, navigationGroups } from "../ui/library.js";
import { ItemIcon } from "../ui/ItemIcon.js";

export function HomePage({ collections, navigate }: { collections: CollectionSummary[]; navigate: AppProps["navigate"] }) {
  const items = useQuery(collectionQuery("items"));
  const featured = items.data ? contentRows(items.data).filter(r => r.category === "equipment" || r.category === "weapon").slice(0, 6) : [];
  return <div className="home-page"><header className="home-header"><span className="eyebrow"><BookOpen size={15}/> A guide to Corealm</span><h1>The world, in detail.</h1><p>Find an item, follow a recipe, or inspect the numbers behind your next upgrade.</p><div className="home-totals"><span><strong>{collections.reduce((sum, c) => sum + c.count, 0).toLocaleString()}</strong> records</span><span><strong>{collections.length}</strong> collections</span></div></header>{featured.length > 0 && <section className="featured-items" aria-label="Equipment"><div className="section-heading"><h2>Equipment</h2><button className="text-button" onClick={() => navigate("items")}>Browse all items <ArrowRight size={15}/></button></div><div className="equipment-strip">{featured.map(r => <button key={rowId(r)} onClick={() => navigate("items", rowId(r))}><ItemIcon id={rowId(r)} name="" large/><strong>{rowName(r)}</strong>{r.tier !== undefined && <span>Tier {String(r.tier)}</span>}</button>)}</div></section>}<div className="home-collections">{navigationGroups(collections).map(group => <section key={group.label}><div className="section-heading"><h2>{group.label}</h2><span>{group.entries.length} collections</span></div><div className="collection-directory">{group.entries.map(c => { const Icon = iconFor(c.name); return <button key={c.name} className="directory-row" onClick={() => navigate(c.name)}><Icon size={21}/><span><strong>{labelFor(c.name)}</strong><small>{descriptions[c.name] ?? "Formula parameters and progression rules."}</small></span><span className="mono">{c.count}</span><ArrowRight size={17}/></button>; })}</div></section>)}</div></div>;
}
