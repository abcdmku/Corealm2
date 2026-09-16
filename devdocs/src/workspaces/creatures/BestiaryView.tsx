import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { Facts } from "../../ui/Sheet.js";
import { publishRecordSet, readListState, writeListState } from "../../model/recordSet.js";
import { useRecordSetKey } from "../../model/recordSetKey.js";
import { Thumb } from "../../ui/Thumb.js";
import { LoadingRows } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { CreaturePage } from "./CreaturePage.js";
import { thumbFor, titleCase, useCreatureData, type CreatureData, type ResolvedCreature } from "./shared.js";
import { Button, Segmented, SearchInput } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { BLOCK_TITLE, COUNT, EMPTY, GROUP, PAGE, TOOLBAR } from "../../ui/layout.js";
import { TileGrid, tileArtClasses, tileClasses, tileSubtitleClasses, tileTitleClasses } from "../../ui/RecordTile.js";

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

  return <div className={cn(PAGE, "bestiary")}>
    <div className={TOOLBAR}>
      <SearchInput label="Search creatures" shortcut onEnter={() => { const first = groups[0]?.rows[0]; if (first) navigate("creatureDefinitions", first.id); }} placeholder="Search name, family, region…" value={search} onChange={setSearch} />
      <Segmented aria-label="Group by">{GROUPS.map(group => <Button variant="segment" size="xs" key={group.value} aria-pressed={groupBy === group.value} onClick={() => setGroupBy(group.value)}>{group.label}</Button>)}</Segmented>
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="chip" size="xs" aria-pressed={availability === "world"} onClick={() => setAvailability(availability === "world" ? undefined : "world")}>World</Button>
        <Button variant="chip" size="xs" aria-pressed={availability === "lab"} onClick={() => setAvailability(availability === "lab" ? undefined : "lab")}>Lab</Button>
        <Button variant="chip" size="xs" aria-pressed={kind === "bases"} onClick={() => setKind(kind === "bases" ? "all" : "bases")}>Bases only</Button>
        <Button variant="chip" size="xs" aria-pressed={kind === "variants"} onClick={() => setKind(kind === "variants" ? "all" : "variants")}>Variants</Button>
      </div>
      <span className={COUNT}>{data.loading ? "" : `${filtered.length} of ${data.resolved.length}`}</span>
      <Segmented aria-label="Layout">
        <Button variant="segment" size="xs" aria-label="Grid" title="Grid" aria-pressed={mode === "grid"} onClick={() => setMode("grid")}><LayoutGrid size={13} /></Button>
        <Button variant="segment" size="xs" aria-label="List" title="List" aria-pressed={mode === "list"} onClick={() => setMode("list")}><List size={13} /></Button>
      </Segmented>
    </div>
    {data.loading && !data.resolved.length && <LoadingRows />}
    {!data.loading && !filtered.length && <p className={EMPTY}>No creatures match.</p>}
    {groups.map(group => {
      const tiles = group.rows.map(row => <CreatureTile key={row.id} row={row} data={data} mode={mode} indent={groupBy === "family" && row.variant} onOpen={() => navigate("creatureDefinitions", row.id)} />);
      return <section className={GROUP} key={group.key}>
        <h2 className={BLOCK_TITLE}>{group.label} <span className="ml-1 font-mono font-normal tracking-normal normal-case">{group.rows.length}</span></h2>
        {mode === "grid" ? <TileGrid compact>{tiles}</TileGrid> : <div className="flex flex-col gap-0.5">{tiles}</div>}
      </section>;
    })}
  </div>;
}

function CreatureTile({ row, data, mode, indent, onOpen }: { row: ResolvedCreature; data: CreatureData; mode: "grid" | "list"; indent: boolean; onOpen: () => void }) {
  const thumb = thumbFor(row, data.ctx);
  const list = mode === "list";
  const facts = [`Level ${row.level}`, row.profile?.name, row.regionId ? data.regionName(row.regionId) : undefined, row.availability === "lab" ? "Lab" : undefined];
  return <div role="button" tabIndex={0} className={tileClasses({ row: list, indent: list && indent })} data-id={row.id} onClick={onOpen} onKeyDown={event => { if (event.key === "Enter") onOpen(); }} title={`${row.name} · ${row.id}`}>
    <span className={tileArtClasses(list)}><Thumb spec={thumb} size={list ? "m" : "xl"} alt="" /></span>
    <span className={cn("flex min-w-0", list ? "flex-1 flex-row items-center gap-2" : "flex-col gap-0.5")}>
      <span className={cn(tileTitleClasses(list), list && "min-w-50")}>{row.name}{row.variant && list && <span className="font-normal text-faint"> · {row.id}</span>}</span>
      <Facts className={cn(tileSubtitleClasses(list), "flex-nowrap")} items={facts} />
    </span>
  </div>;
}
