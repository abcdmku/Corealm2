import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, ClipboardList } from "lucide-react";
import type { AppProps } from "../model/contracts.js";
import type { CollectionSummary } from "../../shared/contracts.js";
import { collectionQuery } from "../api/client.js";
import { contentRows, rowId, rowName } from "../model/rows.js";
import { descriptions, iconFor, navigationGroups, taskDescription } from "../ui/library.js";
import { ItemIcon } from "../ui/ItemIcon.js";

export function HomePage({ collections, navigate }: { collections: CollectionSummary[]; navigate: AppProps["navigate"] }) {
  const items = useQuery(collectionQuery("items"));
  const featured = items.data
    ? contentRows(items.data).filter(row => row.category === "equipment" || row.category === "weapon").slice(0, 6)
    : [];
  const groups = navigationGroups(collections);
  const totalRecords = collections.reduce((sum, collection) => sum + collection.count, 0);

  return <div className="home-page">
    <header className="home-header">
      <span className="eyebrow"><BookOpen size={15} /> {__DEVDOCS_PLAYER__ ? 'Corealm guide' : 'Corealm authoring'}</span>
      <h1>The world, in one place.</h1>
      <p>{__DEVDOCS_PLAYER__ ? 'Explore equipment, creatures, abilities and places in Corealm.' : 'Choose a content area to inspect related records together, then preview and save the change from the record you are working on.'}</p>
      <div className="home-totals"><span><strong>{totalRecords.toLocaleString()}</strong> records</span><span><strong>{groups.length}</strong> workspaces</span>{!__DEVDOCS_PLAYER__ && <button className="text-button" onClick={() => navigate("work-queue")}><ClipboardList size={14} /> Open work queue</button>}</div>
    </header>

    {featured.length > 0 && <section className="featured-items" aria-label="Featured equipment">
      <div className="section-heading"><h2>Equipment</h2><button className="text-button" onClick={() => navigate("items")}>Browse all items <ArrowRight size={15} /></button></div>
      <div className="equipment-strip">{featured.map(row => <button key={rowId(row)} onClick={() => navigate("items", rowId(row))}><ItemIcon id={rowId(row)} name="" large /><strong>{rowName(row)}</strong>{row.tier !== undefined && <span>Tier {String(row.tier)}</span>}</button>)}</div>
    </section>}

    <div className="home-collections" aria-label="Authoring areas">
      {groups.map(group => <section key={group.label}>
        <div className="section-heading"><h2>{group.label}</h2><span>{group.entries[0]?.sources.length ?? 0} related collections</span></div>
        <div className="collection-directory">{group.entries.map(entry => {
          const Icon = iconFor(entry.name);
          return <button key={entry.name} className="directory-row" onClick={() => navigate(entry.name)}><Icon size={21} /><span><strong>{entry.label}</strong><small>{taskDescription(entry.name) || descriptions[entry.name]}</small></span><span className="mono">{entry.count}</span><ArrowRight size={17} /></button>;
        })}</div>
      </section>)}
    </div>
  </div>;
}
