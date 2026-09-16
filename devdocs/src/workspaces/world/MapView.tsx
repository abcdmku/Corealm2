import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { Flag, Footprints, MapPin, Maximize2, Minus, Pickaxe, Plus } from "lucide-react";
import type { ApiDiagnostic, CollectionResponse, ContentOperation } from "../../../shared/contracts.js";
import { collectionQuery } from "../../api/client.js";
import type { ContentRow } from "../../model/contracts.js";
import { recordOperations, runTransaction } from "../../model/draft.js";
import { draftStore } from "../../model/store.js";
import { summaryContext } from "../../model/refs.js";
import { rowName } from "../../model/rows.js";
import { RecordPicker } from "../../ui/RecordPicker.js";
import { ChoiceField } from "../../ui/field/index.js";
import { LoadingRows, ErrorState } from "../../ui/States.js";
import type { ViewProps } from "../types.js";
import { Inspector } from "./Inspector.js";
import { MapCanvas, type MapHandle, type Tool, type View } from "./MapCanvas.js";
import { Rail } from "./Rail.js";
import {
  DRAFT_COLLECTIONS, LAYERS, addLandmark, addLocation, addResourceNode, addSpawn, deriveFeatures, moveSelection, parseSelection, patchPlacement, regionBounds, regionById, round, safeAnchors, sameSelection, selectionId, selectionPoint, worldBounds,
  type Bounds, type Draft, type Feature, type Layer, type Point, type Selection,
} from "./model.js";
import { WORLD_MAP_IMAGE_BOUNDS } from "../../../../game/src/generated/worldMapFingerprint.js";
import "./world.css";

const ISLAND_BOUNDS: Bounds = { ...WORLD_MAP_IMAGE_BOUNDS };

/*
  The world workspace: the map is the page, lists are the rails. The four editable collections
  are held as one draft; Preview and Save go through the shared transaction endpoint so the
  compiler's diagnostics come back for the whole change set.
*/

const LAYER_KEY = "devdocs.world.layers";
const LOOKUP_COLLECTIONS = ["creatureDefinitions", "resources", "npcs", "shops", "assets"] as const;
const TOOL_LABEL: Record<Tool, string> = { spawn: "Add spawn", resource: "Add resource node", location: "Add location", landmark: "Add landmark" };
const TOOL_SHORT: Record<Tool, string> = { spawn: "Spawn", resource: "Resource node", location: "Location", landmark: "Landmark" };

const DEFAULT_LAYERS: ReadonlySet<Layer> = new Set(["regions", "settlements", "landmarks", "spawns", "resources"]);
function loadLayers(): Record<Layer, boolean> {
  const all = Object.fromEntries(LAYERS.map(layer => [layer, DEFAULT_LAYERS.has(layer)])) as Record<Layer, boolean>;
  try {
    const stored = JSON.parse(localStorage.getItem(LAYER_KEY) ?? "{}") as Partial<Record<Layer, boolean>>;
    for (const layer of LAYERS) if (typeof stored[layer] === "boolean") all[layer] = stored[layer]!;
  } catch { /* fresh defaults */ }
  return all;
}

export default function MapView({ recordId, navigate }: ViewProps) {
  const editable = !__DEVDOCS_PLAYER__;
  const queries = useQueries({ queries: [...DRAFT_COLLECTIONS, ...LOOKUP_COLLECTIONS].map(name => collectionQuery(name)) });
  const loading = queries.slice(0, DRAFT_COLLECTIONS.length).some(query => query.isPending);
  const failed = queries.find(query => query.isError);
  // `useQueries` hands back a new array every render; key the memo on the response objects themselves.
  const datas = queries.map(query => query.data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const responses = useMemo(() => new Map(datas.flatMap(data => data ? [[data.collection.name, data] as const] : [])), datas);
  const ctx = useMemo(() => summaryContext({ collections: responses }), [responses]);
  const serverDraft = useMemo<{ draft: Draft; revisions: Record<string, string> } | undefined>(() => {
    if (DRAFT_COLLECTIONS.some(name => !responses.has(name))) return undefined;
    const pick = (name: string) => responses.get(name)!;
    return {
      draft: { worldRegions: pick("worldRegions").data as Draft["worldRegions"], placements: pick("placements").data as Draft["placements"], encounters: pick("encounters").data as Draft["encounters"], resourcePlacements: pick("resourcePlacements").data as Draft["resourcePlacements"] },
      revisions: Object.fromEntries(DRAFT_COLLECTIONS.map(name => [name, pick(name).revision])),
    };
  }, [responses]);

  // ---------------------------------------------------------------- draft

  const [base, setBase] = useState<{ draft: Draft; revisions: Record<string, string> } | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<ApiDiagnostic[]>([]);
  const operations = useMemo<ContentOperation[]>(() => {
    if (!base || !draft) return [];
    return DRAFT_COLLECTIONS.flatMap(name => recordOperations(name, base.draft[name] as ContentRow[], draft[name] as ContentRow[]));
  }, [base, draft]);
  const dirty = operations.length > 0;
  const dirtyRef = useRef(false); dirtyRef.current = dirty;

  useEffect(() => {
    if (!serverDraft || dirtyRef.current) return;
    setBase(serverDraft); setDraft(structuredClone(serverDraft.draft));
  }, [serverDraft]);

  const update = useCallback((change: (draft: Draft) => Draft) => { if (!editable) return; setDraft(current => current ? change(current) : current); setDiagnostics([]); setError(""); }, [editable]);

  async function preview() {
    if (!base || !draft || !operations.length || busy) return;
    setBusy(true); setError("");
    try {
      const response = await runTransaction("preview", base.revisions, operations);
      setDiagnostics(response.diagnostics ?? []);
      toast.message(response.diagnostics?.length ? `${response.diagnostics.length} diagnostics` : "Preview clean");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  // The map's draft saves and discards through the shell save bar with everything else.
  const live = useRef({ base, draft, operations });
  live.current = { base, draft, operations };
  useEffect(() => draftStore.registerContributor({
    key: "world/map", label: "World map", workspace: "world", route: ["world/map"],
    isDirty: () => live.current.operations.length > 0,
    count: () => live.current.operations.length,
    operations: () => live.current.operations,
    revisions: () => live.current.base?.revisions ?? {},
    reset: () => { const current = live.current.base; if (current) { setDraft(structuredClone(current.draft)); setDiagnostics([]); setError(""); } },
    afterSave: response => {
      const current = live.current;
      if (!current.base || !current.draft) return;
      const next = structuredClone(current.draft);
      const revisions = { ...current.base.revisions };
      for (const collection of response.collections) {
        const name = collection.collection.name as keyof Draft;
        if (DRAFT_COLLECTIONS.includes(name)) { next[name] = collection.data as never; revisions[name] = collection.revision; }
      }
      setBase({ draft: structuredClone(next), revisions }); setDraft(next); setDiagnostics(response.diagnostics ?? []);
    },
    onError: (message, _status, body) => { setError(message); if (body?.diagnostics) setDiagnostics(body.diagnostics); },
  }), []);
  useEffect(() => { draftStore.touch(); }, [dirty]);

  // ---------------------------------------------------------------- derived geometry

  const lookups = useMemo(() => {
    const rows = (name: string) => new Map(((responses.get(name)?.data as ContentRow[] | undefined) ?? []).map(row => [String(row.id), row]));
    const creatures = rows("creatureDefinitions"), resources = rows("resources"), npcs = rows("npcs");
    return { creatureName: (id: string) => { const row = creatures.get(id); return row ? rowName(row) : id; }, resource: (id: string) => resources.get(id), npc: (id: string) => npcs.get(id) };
  }, [responses]);
  const derived = useMemo(() => draft ? deriveFeatures(draft, lookups) : undefined, [draft, lookups]);
  const features = derived?.features ?? EMPTY_FEATURES;

  // ---------------------------------------------------------------- selection and view

  const map = useRef<MapHandle>(null);
  const selection = useMemo(() => parseSelection(recordId, draft), [recordId, draft]);
  const selectedFeature = useMemo(() => selection ? features.find(feature => sameSelection(feature.selection, selection)) : undefined, [features, selection]);
  const selectedPlacement = selection?.kind === "placement" && draft ? draft.placements.find(row => row.id === selection.id) : undefined;
  const anchors = useMemo(() => selectedPlacement ? safeAnchors(selectedPlacement) : EMPTY_POINTS, [selectedPlacement]);
  const ownRoute = useRef<string | undefined>(undefined);
  const centred = useRef<string | undefined>(undefined);

  const select = useCallback((next: Selection | undefined) => {
    const id = next ? selectionId(next) : undefined;
    ownRoute.current = id;
    navigate("world/map", id);
  }, [navigate]);

  // Land on whatever the route names, once the draft exists; later route changes from outside recentre too.
  useEffect(() => {
    if (!draft || !recordId) return;
    if (ownRoute.current === recordId || centred.current === recordId) return;
    centred.current = recordId;
    const target = parseSelection(recordId, draft);
    if (!target) return;
    if (target.kind === "region") { const region = regionById(draft, target.id); if (region) map.current?.fit(regionBounds(region)); return; }
    const point = selectionPoint(draft, target);
    if (point) map.current?.centre(point[0], point[1], Math.min(map.current.view().span, 260));
  }, [recordId, draft]);
  useEffect(() => {
    // First load without a route: show the whole world.
    if (draft && !recordId && !centred.current) { centred.current = ""; map.current?.fit(ISLAND_BOUNDS, 1.02); }
  }, [draft, recordId]);

  const [layers, setLayers] = useState(loadLayers);
  const toggleLayer = useCallback((layer: Layer) => setLayers(current => { const next = { ...current, [layer]: !current[layer] }; localStorage.setItem(LAYER_KEY, JSON.stringify(next)); return next; }), []);
  const [search, setSearch] = useState("");
  const [viewBounds, setViewBounds] = useState<Bounds | undefined>(undefined);
  const onViewChange = useCallback((view: View, size: { width: number; height: number }) => {
    const half = view.span / 2, halfZ = (view.span * size.height / size.width) / 2;
    setViewBounds({ minX: view.x - half, maxX: view.x + half, minZ: view.z - halfZ, maxZ: view.z + halfZ });
  }, []);
  const [fitRegion, setFitRegion] = useState("");

  const pick = useCallback((feature: Feature) => {
    select(feature.selection);
    if (feature.bounds) map.current?.fit({ minX: feature.bounds.min[0], maxX: feature.bounds.max[0], minZ: feature.bounds.min[1], maxZ: feature.bounds.max[1] });
    else map.current?.centre(feature.x, feature.z, Math.min(map.current.view().span, 320));
  }, [select]);

  // ---------------------------------------------------------------- editing from the map

  const onMove = useCallback((target: Selection, point: Point) => update(current => moveSelection(current, target, point)), [update]);
  const onMoveAnchor = useCallback((index: number, point: Point) => {
    if (!selectedPlacement) return;
    const offset: Point = [round(point[0] - selectedPlacement.centre[0]), round(point[1] - selectedPlacement.centre[1])];
    update(current => patchPlacement(current, selectedPlacement.id, { anchorAdjustments: [...(selectedPlacement.anchorAdjustments ?? []).filter(row => row.index !== index), { index, offset }].sort((a, b) => a.index - b.index) }));
  }, [selectedPlacement, update]);
  const onNudge = useCallback((dx: number, dz: number) => {
    if (!selection || !draft) return;
    const point = selectionPoint(draft, selection);
    if (point) update(current => moveSelection(current, selection, [point[0] + dx, point[1] + dz]));
  }, [selection, draft, update]);

  const [tool, setTool] = useState<Tool | undefined>(undefined);
  const [pending, setPending] = useState<{ tool: Tool; point: Point; client: { x: number; y: number } } | undefined>(undefined);
  const onPlace = useCallback((point: Point, client: { x: number; y: number }) => {
    if (!tool || !draft) return;
    if (tool === "location") {
      const result = addLocation(draft, point);
      if (result) { update(() => result.draft); select(result.selection); }
      setTool(undefined);
      return;
    }
    setPending({ tool, point, client });
  }, [tool, draft, update, select]);
  function finishAdd(id: string, row: ContentRow) {
    if (!pending || !draft) return;
    const result = pending.tool === "spawn" ? addSpawn(draft, pending.point, id, rowName(row)) : pending.tool === "resource" ? addResourceNode(draft, pending.point, id) : addLandmark(draft, pending.point, id);
    if (result) { update(() => result.draft); select(result.selection); }
    setPending(undefined); setTool(undefined);
  }
  const onEscape = useCallback(() => { if (tool) setTool(undefined); else select(undefined); }, [tool, select]);
  const onFit = useCallback((bounds: Bounds) => map.current?.fit(bounds), []);
  /** Show every place a creature or resource is: fit all of them, with room around a lone one. */
  const showAll = useCallback((members: readonly Feature[]) => {
    if (!members.length) return;
    const xs = members.map(feature => feature.x), zs = members.map(feature => feature.z);
    const pad = 60;
    map.current?.fit({ minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad });
  }, []);

  if (failed) return <ErrorState message={failed.error?.message ?? "The world could not be loaded."} retry={() => void failed.refetch()} />;
  if (loading || !draft || !derived) return <LoadingRows />;

  return <div className="world" data-editable={editable ? "true" : undefined}>
    <Rail features={features} counts={derived.counts} layers={layers} onToggleLayer={toggleLayer} search={search} onSearch={setSearch} viewBounds={viewBounds} selectedKey={selectedFeature?.key} onPick={pick} onShowAll={showAll} />
    <section className="world-stage">
      <div className="world-toolbar">
        {editable && <span className="segmented" role="group" aria-label="Add">
          {(["spawn", "resource", "location", "landmark"] as const).map(kind => { const Icon = kind === "spawn" ? Footprints : kind === "resource" ? Pickaxe : kind === "location" ? MapPin : Flag; return <button type="button" key={kind} className={tool === kind ? "is-active" : ""} aria-pressed={tool === kind} aria-label={TOOL_LABEL[kind]} title={`${TOOL_LABEL[kind]}: click the map`} onClick={() => setTool(tool === kind ? undefined : kind)}><Icon size={12} />{TOOL_SHORT[kind]}</button>; })}
        </span>}
        <button type="button" className="button button-small" onClick={() => map.current?.fit(worldBounds(draft))}><Maximize2 size={12} /> Fit world</button>
        <ChoiceField value={fitRegion || undefined} width="short" ariaLabel="Fit region" allowEmpty="Fit region…"
          options={draft.worldRegions.map(region => ({ value: region.id, label: region.name }))}
          onChange={value => { setFitRegion(value ?? ""); const region = regionById(draft, value); if (region) map.current?.fit(regionBounds(region)); }} />
        <button type="button" className="icon-button" aria-label="Zoom in" onClick={() => map.current?.zoom(1 / 1.5)}><Plus size={14} /></button>
        <button type="button" className="icon-button" aria-label="Zoom out" onClick={() => map.current?.zoom(1.5)}><Minus size={14} /></button>
        {tool && <span className="world-hint">Click the map to place · Esc cancels</span>}
        {(dirty || error) && <span className="world-changes" role={error ? "alert" : undefined}>
          {error ? <span className="world-error" title={error}>{error}</span> : <span className="world-dirty">{operations.length} {operations.length === 1 ? "change" : "changes"}</span>}
          <button type="button" className="button button-small" aria-label="Preview changes" disabled={busy || !dirty} onClick={() => void preview()}>{busy ? "Working…" : "Preview"}</button>
        </span>}
      </div>
      <MapCanvas ref={map} features={features} roads={derived.roads} layers={layers} selection={selection} anchors={anchors} editable={editable} tool={tool}
        onSelect={select} onMove={onMove} onMoveAnchor={onMoveAnchor} onNudge={onNudge} onPlace={onPlace} onViewChange={onViewChange} onEscape={onEscape} />
      {pending && <RecordPicker collection={pending.tool === "spawn" ? "creatureDefinitions" : pending.tool === "resource" ? "resources" : "assets"} ctx={ctx} open onOpenChange={open => { if (!open) { setPending(undefined); setTool(undefined); } }} onPick={finishAdd}
        placeholder={pending.tool === "spawn" ? "Which creature spawns here?" : pending.tool === "resource" ? "Which resource?" : "Which asset?"}
        trigger={<span className="world-picker-anchor" style={{ left: pending.client.x, top: pending.client.y }} aria-hidden="true" />} />}
    </section>
    <Inspector draft={draft} selection={selection} feature={selectedFeature} editable={editable} ctx={ctx} encounterUses={derived.encounterUses} diagnostics={diagnostics} update={update} navigate={navigate} onFit={onFit} onSelect={select} />
  </div>;
}

const EMPTY_FEATURES: Feature[] = [];
const EMPTY_POINTS: Point[] = [];
