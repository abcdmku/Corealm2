import { useEffect, useMemo, useState } from "react";
import type { ViewProps } from "../../types.js";
import { useArtDigest } from "../../../model/artReview.js";
import { readListState, writeListState } from "../../../model/recordSet.js";
import { LoadingRows } from "../../../ui/States.js";
import { useCreatureData } from "../../creatures/shared.js";
import { BodyIndex } from "./BodyIndex.js";
import { BodyFocus, rememberVariant } from "./BodyFocus.js";
import { bodyEntries, DEFAULT_FILTERS, filterBodies, type BodyFilters } from "./model.js";

/*
  Art review for creatures. The index is a contact sheet of bodies (one model, every definition
  that wears it); a body's page puts the model on a stage with its states and variants under it.
  Route: #/art/creatures[/<assetId>]. A creature id is accepted too and opens its body with that
  variant selected.
*/
export default function CreaturesView({ recordId, navigate }: ViewProps) {
  const data = useCreatureData();
  const { entries, lookNameRepeats } = useMemo(() => bodyEntries(data), [data]);
  const digest = useArtDigest("assets");
  const [filters, setFilters] = useState<BodyFilters>(() => readListState("art/creatures", DEFAULT_FILTERS));
  useEffect(() => { writeListState("art/creatures", filters); }, [filters]);
  const shown = useMemo(() => filterBodies(entries, filters, digest.data), [entries, filters, digest.data]);
  // The state under review stays picked while walking bodies, so "death on every body" is one key per body.
  const [state, setState] = useState("idle");

  const open = (assetId: string) => navigate("art/creatures", assetId);
  const current = recordId ? entries.find(entry => entry.assetId === recordId) : undefined;
  const owner = recordId && !current ? entries.find(entry => entry.body.looks.some(look => look.creatureId === recordId)) : undefined;
  useEffect(() => {
    if (!owner || !recordId) return;
    rememberVariant(owner.assetId, recordId);
    navigate("art/creatures", owner.assetId);
  }, [owner, recordId, navigate]);

  if (!recordId) return <BodyIndex entries={shown} total={entries.length} regions={data.regions} filters={filters} setFilters={setFilters} loading={data.loading} open={open} />;
  if (!current) return data.loading || owner ? <div className="p-4"><LoadingRows /></div> : <p className="p-4 text-xs text-faint">No creature body or definition is called {recordId}.</p>;
  // A body reached by link may sit outside the current filter; the rail still lists it.
  const list = shown.includes(current) ? shown : [current, ...shown];
  return <BodyFocus entry={current} list={list} data={data} lookNameRepeats={lookNameRepeats} bodyDigest={digest.data} state={state} setState={setState} open={open} navigate={navigate} />;
}
