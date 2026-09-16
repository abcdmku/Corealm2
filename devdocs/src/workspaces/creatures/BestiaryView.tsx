import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, List, Search, X } from "lucide-react";
import { Facts } from "../../ui/Sheet.js";
import { publishRecordSet, readListState, writeListState } from "../../model/recordSet.js";
import { useRecordSetKey } from "../../model/recordSetKey.js";
import { Thumb } from "../../ui/Thumb.js";
import { LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { CreaturePage } from "./CreaturePage.js";
import { thumbFor, titleCase, useCreatureData, type CreatureData, type ResolvedCreature } from "./shared.js";
import "./creatures.css";
import { Button, InputGroup, InputGroupAddon, InputGroupInput } from "../../components/ui/index.js";

type GroupBy = "region" | "level" | "family" | "role";
type Kind = "all" | "bases" | "variants";
const GROUPS: readonly { value: GroupBy; label: string }[] = [{ value: "region", label: "Region" }, { value: "level", label: "Level" }, { value: "family", label: "Family" }, { value: "role", label: "Role" }];
const ROLE_ORDER = ["grazer", "skirmisher", "brute", "guardian", "caster", "boss"];

/** Every creature as a rendered tile, grouped by where it lives, how strong it is, or what it is. */
export default function BestiaryView({ recordId, navigate }: ViewProps) {
  if (recordId) return <CreaturePage key={recordId} id={recordId} navigate={navigate} />;
  return <BestiaryGrid navigate={navigate} />;
}

interface Group { key: string; label: string; rows: ResolvedCreature[] }

function groupCreatures(data: CreatureData, rows: ResolvedCreature[], by: GroupBy): Group[] {
  const groups = new Map<string, Group>();
  const keyOf = (row: ResolvedCreature): [string, string] => {
    switch (by) {
      case "region": return [row.regionId ?? "~", data.regionName(row.regionId)];
      case "level": return [String(row.level).padStart(3, "0"), `Level ${row.level}`];
      case "family": return [row.family ?? "~", row.family ? titleCase(row.family) : "No family"];
      case "role": return [row.profile ? String(ROLE_ORDER.indexOf(row.profile.role)) : "~", row.profile?.name ?? "No role"];
    }
  };
  for (const row of rows) {
    const [key, label] = keyOf(row);
    let group = groups.get(key);
    if (!group) { group = { key, label, rows: [] }; groups.set(key, group); }
    group.rows.push(row);
  }
  const regionOrder = new Map(data.regions.map((region, index) => [region.id, index]));
  const ordered = [...groups.values()].sort((a, b) => by === "region" ? (regionOrder.get(a.key) ?? 99) - (regionOrder.get(b.key) ?? 99) || a.key.localeCompare(b.key) : a.key.localeCompare(b.key));
  for (const group of ordered) group.rows = orderRows(group.rows, by === "family");
  return ordered;
}

/** Bases first, each followed by its variants, when the grouping keeps families together. Otherwise by level then name. */
function orderRows(rows: ResolvedCreature[], byFamily: boolean): ResolvedCreature[] {
  const byLevel = (a: ResolvedCreature, b: ResolvedCreature) => a.level - b.level || a.name.localeCompare(b.name);
  if (!byFamily) return [...rows].sort(byLevel);
  const present = new Set(rows.map(row => row.id));
  const bases = rows.filter(row => !row.variant || !present.has(row.definition.baseId ?? "")).sort(byLevel);
  const variants = rows.filter(row => row.variant && present.has(row.definition.baseId ?? "")).sort(byLevel);
  return bases.flatMap(base => [base, ...variants.filter(variant => variant.definition.baseId === base.id)]);
}

function BestiaryGrid({ navigate }: { navigate: ViewProps["navigate"] }) {
  const data = useCreatureData();
  const saved = useMemo(() => readListState("creatures/bestiary", { search: "", groupBy: "region" as GroupBy, availability: undefined as "world" | "lab" | undefined, kind: "all" as Kind, mode: "grid" as "grid" | "list" }), []);
  const [search, setSearch] = useState(saved.search);
  const [groupBy, setGroupBy] = useState<GroupBy>(saved.groupBy);
  const [availability, setAvailability] = useState<"world" | "lab" | undefined>(saved.availability);
  const [kind, setKind] = useState<Kind>(saved.kind);
  const [mode, setMode] = useState<"grid" | "list">(saved.mode);
  useEffect(() => { writeListState("creatures/bestiary", { search, groupBy, availability, kind, mode }); }, [search, groupBy, availability, kind, mode]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.resolved.filter(row => {
      if (availability && row.availability !== availability) return false;
      if (kind === "bases" && row.variant) return false;
      if (kind === "variants" && !row.variant) return false;
      if (!needle) return true;
      return `${row.name} ${row.id} ${row.family ?? ""} ${row.regionId ?? ""} ${row.profile?.name ?? ""}`.toLowerCase().includes(needle);
    });
  }, [data, search, availability, kind]);
  const groups = useMemo(() => groupCreatures(data, filtered, groupBy), [data, filtered, groupBy]);
  const setKey = useRecordSetKey();
  useEffect(() => {
    if (!setKey || data.loading) return;
    publishRecordSet(setKey, { label: search.trim() ? `"${search.trim()}"` : undefined, entries: groups.flatMap(group => group.rows.map(row => ({ id: row.id, title: row.name, subtitle: `Level ${row.level} · ${group.label}` }))) });
  }, [setKey, groups, search, data.loading]);

  return <div className="ws-page bestiary">
    <div className="bestiary-toolbar">
      <InputGroup className="w-60"><InputGroupAddon align="start"><Search /></InputGroupAddon><InputGroupInput aria-label="Search creatures" placeholder="Search name, family, region…" value={search} onChange={event => setSearch(event.target.value)} />{search && <Button variant="ghost" size="icon-sm" aria-label="Clear search" onClick={() => setSearch("")}><X size={13} /></Button>}</InputGroup>
      <div role="group" className="inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-card p-0.5" aria-label="Group by">{GROUPS.map(group => <Button variant="segment" size="xs" key={group.value} aria-pressed={groupBy === group.value} onClick={() => setGroupBy(group.value)}>{group.label}</Button>)}</div>
      <div className="chip-row">
        <Button variant="chip" size="xs" aria-pressed={availability === "world"} onClick={() => setAvailability(availability === "world" ? undefined : "world")}>World</Button>
        <Button variant="chip" size="xs" aria-pressed={availability === "lab"} onClick={() => setAvailability(availability === "lab" ? undefined : "lab")}>Lab</Button>
        <Button variant="chip" size="xs" aria-pressed={kind === "bases"} onClick={() => setKind(kind === "bases" ? "all" : "bases")}>Bases only</Button>
        <Button variant="chip" size="xs" aria-pressed={kind === "variants"} onClick={() => setKind(kind === "variants" ? "all" : "variants")}>Variants</Button>
      </div>
      <span className="bestiary-count mono">{data.loading ? "" : `${filtered.length} of ${data.resolved.length}`}</span>
      <div role="group" className="inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-card p-0.5" aria-label="Layout">
        <Button variant="segment" size="xs" aria-label="Grid" title="Grid" aria-pressed={mode === "grid"} onClick={() => setMode("grid")}><LayoutGrid size={13} /></Button>
        <Button variant="segment" size="xs" aria-label="List" title="List" aria-pressed={mode === "list"} onClick={() => setMode("list")}><List size={13} /></Button>
      </div>
    </div>
    {data.loading && !data.resolved.length && <LoadingRows />}
    {!data.loading && !filtered.length && <p className="empty-inline">No creatures match.</p>}
    {groups.map(group => <section className="bestiary-group" key={group.key}>
      <h2>{group.label}</h2>
      <div className={mode === "grid" ? "tile-grid" : "bestiary-list"} data-density="compact">
        {group.rows.map(row => <CreatureTile key={row.id} row={row} data={data} mode={mode} indent={groupBy === "family" && row.variant} onOpen={() => navigate("creatureDefinitions", row.id)} />)}
      </div>
    </section>)}
  </div>;
}

function CreatureTile({ row, data, mode, indent, onOpen }: { row: ResolvedCreature; data: CreatureData; mode: "grid" | "list"; indent: boolean; onOpen: () => void }) {
  const thumb = thumbFor(row, data.ctx);
  const facts = [`Level ${row.level}`, row.profile?.name, row.regionId ? data.regionName(row.regionId) : undefined, row.availability === "lab" ? "Lab" : undefined];
  return <div role="button" tabIndex={0} className={`tile${mode === "list" ? " tile-row" : ""}${indent ? " is-variant" : ""}`} data-id={row.id} onClick={onOpen} onKeyDown={event => { if (event.key === "Enter") onOpen(); }} title={`${row.name} · ${row.id}`}>
    <span className="tile-art"><Thumb spec={thumb} size={mode === "grid" ? "xl" : "m"} alt="" /></span>
    <span className="tile-body">
      <span className="tile-title">{row.name}{row.variant && mode === "list" && <span className="muted"> · {row.id}</span>}</span>
      <Facts className="tile-subtitle" items={facts} />
    </span>
  </div>;
}
