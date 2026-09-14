import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Crosshair, Image as ImageIcon, MapPin, Maximize2, Minus, Pencil, Plus, Route, Search, TreePine, X } from 'lucide-react';
import { apiGet } from '../api/client.js';
import type { CollectionResponse, ContentOperation, ContentTransactionRequest, ContentTransactionResponse } from '../../shared/contracts.js';
import type { EncounterDefinition, WorldPlacement } from '../../../game/src/content/schema/encounters.js';
import { placementAnchors } from '../../../game/src/content/worldCompiler.js';
import { WORLD_MAP_DETAIL_RENDITIONS, WORLD_MAP_IMAGE_BOUNDS, WORLD_MAP_MINIMAP_RENDITION } from '../../../game/src/generated/worldMapFingerprint.js';
import regions from '../../../game/content/data/worldRegions.json';
import type { ContentRow } from '../model/contracts.js';
import { gameUrl } from '../model/gameUrl.js';
import { summaryContext, useReferenceIndex } from '../model/refs.js';
import { contentRows } from '../model/rows.js';
import { summarize, type SummaryContext, type ThumbSpec } from '../model/summaries.js';
import { Menu } from '../ui/Menu.js';
import { RecordPicker } from '../ui/RecordPicker.js';
import { RefChip, RefRow } from '../ui/RefChip.js';
import './worldPage.css';

type Draft = { encounters: EncounterDefinition[]; placements: WorldPlacement[] };
type Snapshot = { draft: Draft; revisions: Record<string, string> };
type View = { x: number; z: number; span: number };
type Drag =
  | { kind: 'pan'; start: [number, number]; view: View; scale: number }
  | { kind: 'move'; id: string; start: [number, number]; centre: [number, number] }
  | { kind: 'anchor'; id: string; anchor: number; start: [number, number]; offset: [number, number] };
type Resource = { id: string; x: number; z: number; radius: number; regionId: string };

const empty: Draft = { encounters: [], placements: [] };
const MIN_SPAN = 12;
const MAX_SPAN = 4000;
const ACTIVITIES = ['graze', 'forage', 'prowl', 'patrol'] as const;
const IMAGE = { x: WORLD_MAP_IMAGE_BOUNDS.minX, y: WORLD_MAP_IMAGE_BOUNDS.minZ, width: WORLD_MAP_IMAGE_BOUNDS.maxX - WORLD_MAP_IMAGE_BOUNDS.minX, height: WORLD_MAP_IMAGE_BOUNDS.maxZ - WORLD_MAP_IMAGE_BOUNDS.minZ };
const RENDITIONS = [WORLD_MAP_MINIMAP_RENDITION, ...WORLD_MAP_DETAIL_RENDITIONS].map(row => ({ path: row.path, width: row.width })).sort((a, b) => a.width - b.width);
const round = (value: number) => Math.round(value * 100) / 100;
const asRow = (row: object) => row as ContentRow;
const hueOf = (spec: ThumbSpec) => spec.kind === 'glyph' || spec.kind === 'asset' ? spec.hue : undefined;

/** Pick the smallest pre-rendered map that still has a pixel per screen pixel at this zoom. */
function renditionFor(pixelsPerMetre: number) {
  const needed = IMAGE.width * pixelsPerMetre;
  return RENDITIONS.find(row => row.width >= needed) ?? RENDITIONS.at(-1)!;
}
function fit(rows: readonly { centre: readonly [number, number]; radius: number }[], aspect: number): View {
  if (!rows.length) return fitBounds(WORLD_MAP_IMAGE_BOUNDS.minX, WORLD_MAP_IMAGE_BOUNDS.minZ, WORLD_MAP_IMAGE_BOUNDS.maxX, WORLD_MAP_IMAGE_BOUNDS.maxZ, aspect);
  const left = Math.min(...rows.map(p => p.centre[0] - p.radius));
  const right = Math.max(...rows.map(p => p.centre[0] + p.radius));
  const top = Math.min(...rows.map(p => p.centre[1] - p.radius));
  const bottom = Math.max(...rows.map(p => p.centre[1] + p.radius));
  return fitBounds(left, top, right, bottom, aspect, 40);
}
function fitBounds(left: number, top: number, right: number, bottom: number, aspect: number, minimum = 0): View {
  return { x: (left + right) / 2, z: (top + bottom) / 2, span: Math.min(MAX_SPAN, Math.max(minimum, right - left, (bottom - top) / aspect) * 1.15) };
}
function operations(before: Draft, after: Draft): ContentOperation[] {
  return (['encounters', 'placements'] as const).flatMap(collection => {
    const old = new Map(before[collection].map(row => [row.id, row]));
    const current = new Set(after[collection].map(row => row.id));
    const changes: ContentOperation[] = before[collection].filter(row => !current.has(row.id)).map(row => ({ kind: 'delete', collection, id: row.id }));
    for (const row of after[collection]) if (JSON.stringify(old.get(row.id)) !== JSON.stringify(row)) changes.push({ kind: 'put', collection, id: row.id, record: row, ...(!old.has(row.id) ? { create: true } : {}) });
    return changes;
  });
}
function StatInput({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return <label className="stat world-stat"><span>{label}</span><input aria-label={label} type="number" step={step ?? 'any'} min={min} max={max} value={value} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) onChange(next); }} /></label>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="world-field"><span>{label}</span>{children}</div>;
}

export function WorldPage({ navigate }: { navigate?: (collection?: string, recordId?: string) => void } = {}) {
  const queryClient = useQueryClient();
  const { index } = useReferenceIndex();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<Draft>(empty);
  const [creatures, setCreatures] = useState<{ id: string; name?: string }[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [encounterId, setEncounterId] = useState('');
  const [creating, setCreating] = useState<'encounter' | 'placement'>();
  const [newId, setNewId] = useState('');
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [view, setView] = useState<View>({ x: 0, z: 0, span: 800 });
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [layers, setLayers] = useState({ minimap: true, resources: true });
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [hover, setHover] = useState<{ id: string; x: number; y: number }>();
  const [dragging, setDragging] = useState<Drag['kind']>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<ContentTransactionResponse>();
  const drag = useRef<Drag | undefined>(undefined);
  const svg = useRef<SVGSVGElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const editable = !__DEVDOCS_PLAYER__;
  const loaded = Boolean(snapshot);

  const selected = draft.placements.find(row => row.id === selectedId);
  const encounter = draft.encounters.find(row => row.id === encounterId);
  const changes = useMemo(() => snapshot ? operations(snapshot.draft, draft) : [], [snapshot, draft]);
  // Summaries resolve encounters and placements from the unsaved draft first, so list titles and pins follow edits.
  const ctx = useMemo<SummaryContext>(() => {
    const base = summaryContext(index);
    const encounters = new Map(draft.encounters.map(row => [row.id, asRow(row)]));
    const placements = new Map(draft.placements.map(row => [row.id, asRow(row)]));
    return { lookup: (kind, id) => (kind === 'encounter' ? encounters.get(id) : kind === 'placement' ? placements.get(id) : undefined) ?? base.lookup(kind, id) };
  }, [index, draft.encounters, draft.placements]);
  const encounterHue = useMemo(() => new Map(draft.encounters.map(row => {
    const creature = row.members[0] ? ctx.lookup('enemy', row.members[0].creatureId) : undefined;
    return [row.id, creature ? hueOf(summarize('creatureDefinitions', creature, ctx).thumb) : undefined] as const;
  })), [draft.encounters, ctx]);
  const resources = useMemo<Resource[]>(() => {
    const response = index.collections.get('resourcePlacements');
    return response ? contentRows(response).flatMap(row => Array.isArray(row.centre) && row.centre.length === 2 ? [{ id: String(row.id), x: Number(row.centre[0]), z: Number(row.centre[1]), radius: Number(row.radius ?? 0), regionId: String(row.regionId ?? '') }] : []) : [];
  }, [index]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return draft.placements.filter(row => (!region || row.regionId === region) && (!needle || `${row.id} ${row.encounterId} ${summarize('placements', asRow(row), ctx).title}`.toLowerCase().includes(needle)));
  }, [draft.placements, region, search, ctx]);
  const regionCounts = useMemo(() => { const counts = new Map<string, number>(); for (const row of draft.placements) counts.set(row.regionId, (counts.get(row.regionId) ?? 0) + 1); return counts; }, [draft.placements]);
  const geometry = useMemo(() => {
    try { return { anchors: selected ? placementAnchors(selected) : [], error: '' }; }
    catch (reason) { return { anchors: [] as [number, number][], error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [selected]);
  const aspect = size.height / size.width;
  const marker = view.span / 180;
  const rendition = renditionFor(size.width / view.span);

  useEffect(() => {
    let active = true;
    Promise.all(['encounters', 'placements', 'creatureDefinitions'].map(name => apiGet<CollectionResponse>(`collections/${name}`))).then(([encounters, placements, creatureRows]) => {
      if (!active) return;
      const initial = { encounters: encounters!.data as EncounterDefinition[], placements: placements!.data as WorldPlacement[] };
      setSnapshot({ draft: structuredClone(initial), revisions: { encounters: encounters!.revision, placements: placements!.revision, creatureDefinitions: creatureRows!.revision } });
      setDraft(initial); setCreatures(creatureRows!.data as { id: string; name?: string }[]);
      setSelectedId(initial.placements[0]?.id ?? ''); setEncounterId(initial.placements[0]?.encounterId ?? initial.encounters[0]?.id ?? '');
      setView(fit(initial.placements, 0.75));
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!changes.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changes.length]);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => { const rect = entries[0]?.contentRect; if (rect && rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loaded]);
  useEffect(() => {
    // React registers wheel listeners as passive, so the browser would scroll the page; attach our own.
    const element = svg.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = element.getScreenCTM();
      if (!matrix) return;
      const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const factor = Math.exp(Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 60) * (event.ctrlKey ? 0.01 : 0.005));
      setView(current => {
        const span = Math.max(MIN_SPAN, Math.min(MAX_SPAN, current.span * factor));
        const ratio = span / current.span;
        return { x: cursor.x - (cursor.x - current.x) * ratio, z: cursor.y - (cursor.y - current.z) * ratio, span };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [loaded]);
  useEffect(() => {
    if (!selectedId) return;
    list.current?.querySelector(`[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  function edit(next: Draft | ((previous: Draft) => Draft)) { setDraft(next); setPreview(undefined); setNotice(''); }
  function patchPlacement(id: string, patch: Partial<WorldPlacement>) { edit(previous => ({ ...previous, placements: previous.placements.map(row => row.id === id ? { ...row, ...patch } : row) })); }
  function patchEncounter(patch: Partial<EncounterDefinition>) { if (encounter) edit(previous => ({ ...previous, encounters: previous.encounters.map(row => row.id === encounter.id ? { ...row, ...patch } : row) })); }
  function choose(row: WorldPlacement) { setSelectedId(row.id); setEncounterId(row.encounterId); setAnchorIndex(0); }
  function adjustAnchor(row: WorldPlacement, index: number, offset: [number, number]) {
    patchPlacement(row.id, { anchorAdjustments: [...(row.anchorAdjustments ?? []).filter(a => a.index !== index), { index, offset }].sort((a, b) => a.index - b.index) });
  }
  function zoom(factor: number) { setView(current => ({ ...current, span: Math.max(MIN_SPAN, Math.min(MAX_SPAN, current.span * factor)) })); }
  function add(kind: 'encounter' | 'placement') {
    const id = newId.trim();
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) { setError('Use an ID beginning with a lowercase letter, followed by letters, numbers, underscores or hyphens.'); return; }
    if ((kind === 'encounter' ? draft.encounters : draft.placements).some(row => row.id === id)) { setError(`The ID ${id} already exists.`); return; }
    setError('');
    if (kind === 'encounter') {
      if (!creatures.length) { setError('Create a creature before adding an encounter.'); return; }
      const row: EncounterDefinition = { id, name: id.replace(/[_-]/g, ' '), activity: 'patrol', members: [{ creatureId: creatures[0]!.id, weight: 1 }] };
      edit({ ...draft, encounters: [...draft.encounters, row] }); setEncounterId(id);
    } else {
      if (!encounterId) { setError('Choose or create an encounter first.'); return; }
      const targetRegion = regions.find(row => row.id === region) ?? regions.find(row => view.x >= row.bounds.min[0]! && view.x <= row.bounds.max[0]! && view.z >= row.bounds.min[1]! && view.z <= row.bounds.max[1]!) ?? regions.find(row => row.id === selected?.regionId) ?? regions[0]!;
      const centre: [number, number] = [round(Math.max(targetRegion.bounds.min[0]! + 8, Math.min(targetRegion.bounds.max[0]! - 8, view.x))), round(Math.max(targetRegion.bounds.min[1]! + 8, Math.min(targetRegion.bounds.max[1]! - 8, view.z)))];
      const row: WorldPlacement = { id, encounterId, regionId: targetRegion.id, centre, count: 1, radius: 8, formation: { kind: 'grid', spacing: 3, rotation: 0 }, dressing: [] };
      edit({ ...draft, placements: [...draft.placements, row] }); choose(row); setView(fit([row], aspect));
    }
    setNewId(''); setCreating(undefined);
  }
  async function submit(operation: 'preview' | 'save') {
    if (!snapshot || !changes.length || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const request: ContentTransactionRequest = { operation, revisions: snapshot.revisions, changes };
      const response = await fetch('/__devdocs/transaction', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      const body = await response.json() as ContentTransactionResponse & { error?: string };
      if (!response.ok) throw new Error([body.error ?? `Request failed (${response.status})`, ...(body.diagnostics ?? []).map(d => `${d.path}: ${d.message}`)].join('\n'));
      if (!Array.isArray(body.affected) || !Array.isArray(body.collections)) throw new Error('Incomplete transaction response. Your draft is retained.');
      setPreview(body);
      if (operation === 'save') {
        const next = structuredClone(draft);
        const revisions = { ...snapshot.revisions };
        for (const collection of body.collections) {
          revisions[collection.collection.name] = collection.revision;
          if (collection.collection.name === 'encounters') next.encounters = collection.data as EncounterDefinition[];
          if (collection.collection.name === 'placements') next.placements = collection.data as WorldPlacement[];
        }
        setSnapshot({ draft: structuredClone(next), revisions }); setDraft(next);
        setNotice(`Saved ${changes.length} source changes. ${body.affected.length} records affected.`);
        await queryClient.invalidateQueries({ queryKey: ['collection'] });
      }
    } catch (reason) { setError(`${reason instanceof Error ? reason.message : String(reason)}\nYour draft is retained. If sources changed elsewhere, reload after copying your draft.`); }
    finally { setBusy(false); }
  }
  function mapPoint(event: { clientX: number; clientY: number }): [number, number] {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return [0, 0];
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [point.x, point.y];
  }
  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    setHover(undefined);
    const target = (event.target as Element).closest('[data-placement]');
    const row = draft.placements.find(p => p.id === target?.getAttribute('data-placement'));
    if (!row) {
      drag.current = { kind: 'pan', start: [event.clientX, event.clientY], view, scale: view.span / size.width };
      setDragging('pan'); event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
      return;
    }
    choose(row);
    if (!editable || busy) return;
    const raw = target?.getAttribute('data-anchor');
    const anchor = raw !== null && raw !== undefined ? Number(raw) : undefined;
    const start = mapPoint(event);
    if (anchor === undefined) drag.current = { kind: 'move', id: row.id, start, centre: [...row.centre] };
    else {
      setAnchorIndex(anchor);
      const point = placementAnchors(row)[anchor]!;
      drag.current = { kind: 'anchor', id: row.id, anchor, start, offset: [point[0] - row.centre[0], point[1] - row.centre[1]] };
    }
    setDragging(drag.current.kind); event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (!active) return;
    if (active.kind === 'pan') {
      setView({ ...active.view, x: active.view.x - (event.clientX - active.start[0]) * active.scale, z: active.view.z - (event.clientY - active.start[1]) * active.scale });
      return;
    }
    const point = mapPoint(event);
    const delta = [point[0] - active.start[0], point[1] - active.start[1]] as const;
    if (active.kind === 'move') patchPlacement(active.id, { centre: [round(active.centre[0] + delta[0]), round(active.centre[1] + delta[1])] });
    else {
      const row = draft.placements.find(p => p.id === active.id);
      if (row) adjustAnchor(row, active.anchor, [round(active.offset[0] + delta[0]), round(active.offset[1] + delta[1])]);
    }
  }
  function pointerEnd() { drag.current = undefined; setDragging(undefined); }

  const selectedAnchor = geometry.anchors[anchorIndex];
  const selectedOffset = selected && selectedAnchor ? [selectedAnchor[0] - selected.centre[0], selectedAnchor[1] - selected.centre[1]] : [0, 0];
  const hovered = hover ? draft.placements.find(row => row.id === hover.id) : undefined;
  const usedBy = encounter ? draft.placements.filter(row => row.encounterId === encounter.id).length : 0;
  const memberIds = new Set(encounter?.members.map(member => member.creatureId));
  const open = (collection: string, id: string) => navigate?.(collection, id);
  const disabled = !editable || busy;

  return <div className="world-page">
    <header className="page-heading">
      <h1>World</h1>
      {snapshot && <span className="count-badge">{draft.placements.length} placements · {draft.encounters.length} encounters</span>}
      {editable && snapshot && <div className="page-heading-actions">
        <button className="button button-small" disabled={!changes.length || busy} onClick={() => void submit('preview')}>Preview</button>
        <button className="button button-small button-primary" disabled={!changes.length || busy} onClick={() => void submit('save')}>{busy ? 'Validating…' : `Save${changes.length ? ` ${changes.length}` : ''}`}</button>
        <button className="button button-small" disabled={!changes.length || busy} onClick={() => { edit(structuredClone(snapshot.draft)); setError(''); }}>Discard</button>
      </div>}
    </header>
    {error && <div className="world-feedback" role="alert">{error}</div>}
    {notice && <div className="world-feedback" data-tone="ok" role="status">{notice}</div>}
    {!snapshot ? <p className="empty-inline" role="status">Loading world sources…</p> : <div className="world-layout">
      <aside className="world-side panel" aria-label="Placements">
        <div className="panel-header">
          <h2>Placements</h2><span className="count-badge">{filtered.length}</span>
          {editable && <div className="panel-header-actions">
            <Menu align="end" trigger={<button type="button" className="button button-small"><Plus size={12} /> New</button>} items={[
              { label: 'Encounter', icon: <Route size={13} />, onSelect: () => { setCreating('encounter'); setNewId(''); } },
              { label: 'Placement at map centre', icon: <MapPin size={13} />, disabled: !encounterId, onSelect: () => { setCreating('placement'); setNewId(''); } },
            ]} />
          </div>}
        </div>
        {creating && <form className="world-create" onSubmit={event => { event.preventDefault(); add(creating); }}>
          <label className="field-input"><input autoFocus aria-label={`New ${creating} ID`} placeholder={creating === 'encounter' ? 'moonlit_patrol' : 'moonlit_patrol_north'} value={newId} onChange={event => setNewId(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setCreating(undefined); }} /></label>
          <button type="submit" className="button button-small button-primary" disabled={busy}>Add {creating}</button>
          <button type="button" className="icon-button" aria-label="Cancel" onClick={() => setCreating(undefined)}><X size={14} /></button>
        </form>}
        <div className="world-filters">
          <label className="search-field"><Search size={14} /><input type="search" placeholder="Find placement…" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="chip-row">
            <button type="button" className={`filter-chip${!region ? ' is-active' : ''}`} onClick={() => setRegion('')}>All <small>{draft.placements.length}</small></button>
            {regions.map(row => <button type="button" key={row.id} className={`filter-chip${region === row.id ? ' is-active' : ''}`} onClick={() => setRegion(region === row.id ? '' : row.id)}>{row.name} <small>{regionCounts.get(row.id) ?? 0}</small></button>)}
          </div>
        </div>
        <div className="world-list ref-rows" ref={list}>
          {filtered.map(row => <div key={row.id} data-id={row.id} className={`world-row${row.id === selectedId ? ' is-selected' : ''}`}>
            <RefRow collection="placements" record={asRow(row)} id={row.id} ctx={ctx} onOpen={() => choose(row)} meta={`×${row.count}`} />
            <button type="button" className="icon-button" aria-label={`Open ${row.id}`} title="Open record" onClick={() => open('placements', row.id)}><ArrowUpRight size={14} /></button>
          </div>)}
          {!filtered.length && <p className="world-empty">No placements match.</p>}
        </div>
      </aside>

      <section className="world-map-panel panel" aria-label="Map">
        <div className="world-map-tools">
          <button type="button" className="button button-small" onClick={() => setView(fit(filtered, aspect))}>Fit {region ? regions.find(row => row.id === region)?.name ?? 'region' : 'all'}</button>
          <button type="button" className="button button-small" disabled={!selected} onClick={() => selected && setView(fit([selected], aspect))}><Crosshair size={12} /> Focus</button>
          <button type="button" className="icon-button" aria-label="Fit whole world" title="Fit whole world" onClick={() => setView(fit([], aspect))}><Maximize2 size={14} /></button>
          <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1 / 1.5)}><Plus size={14} /></button>
          <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1.5)}><Minus size={14} /></button>
          <span className="world-map-sep" />
          <button type="button" className={`icon-button${layers.minimap ? ' is-active' : ''}`} aria-pressed={layers.minimap} aria-label="Toggle map image" title="Map image" onClick={() => setLayers(l => ({ ...l, minimap: !l.minimap }))}><ImageIcon size={14} /></button>
          <button type="button" className={`icon-button${layers.resources ? ' is-active' : ''}`} aria-pressed={layers.resources} aria-label="Toggle resource placements" title={`Resource placements (${resources.length})`} onClick={() => setLayers(l => ({ ...l, resources: !l.resources }))}><TreePine size={14} /></button>
          <span className="count-badge">{filtered.length} placements · {filtered.reduce((sum, row) => sum + row.count, 0)} actors</span>
        </div>
        <div className="world-map-frame" ref={frame}>
          <svg ref={svg} className="world-map" data-drag={dragging} viewBox={`${view.x - view.span / 2} ${view.z - view.span * aspect / 2} ${view.span} ${view.span * aspect}`} preserveAspectRatio="xMidYMid slice" role="img"
            aria-label="Encounter placement map. Drag a pin to move its population; drag a small anchor to adjust one actor. Scroll to zoom, drag empty space to pan."
            onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
            {layers.minimap && <image className="world-map-image" href={gameUrl(rendition.path)} x={IMAGE.x} y={IMAGE.y} width={IMAGE.width} height={IMAGE.height} preserveAspectRatio="none" />}
            {regions.map(row => <g key={row.id} className={`world-map-region${region === row.id ? ' is-active' : ''}`}>
              <rect x={row.bounds.min[0]} y={row.bounds.min[1]} width={row.bounds.max[0]! - row.bounds.min[0]!} height={row.bounds.max[1]! - row.bounds.min[1]!} />
              <text x={row.bounds.min[0]! + marker * 1.5} y={row.bounds.min[1]! + marker * 4} fontSize={marker * 2.6}>{row.name}</text>
            </g>)}
            {layers.resources && resources.map(row => (!region || row.regionId === region) && <circle key={row.id} className="world-resource" cx={row.x} cy={row.z} r={marker * 0.7}><title>{row.id}</title></circle>)}
            {filtered.map(row => {
              const hue = encounterHue.get(row.encounterId);
              return <g key={row.id} className={`world-pin${row.id === selectedId ? ' is-selected' : ''}`} data-rank={row.rank}>
                <circle className="world-pin-radius" cx={row.centre[0]} cy={row.centre[1]} r={row.radius} />
                <circle className="world-pin-dot" data-placement={row.id} cx={row.centre[0]} cy={row.centre[1]} r={marker * 1.6} style={hue !== undefined ? { fill: `hsl(${hue} 52% 62%)` } : undefined}
                  onPointerEnter={event => { if (!drag.current) setHover({ id: row.id, x: event.clientX, y: event.clientY }); }} onPointerLeave={() => setHover(current => current?.id === row.id ? undefined : current)} />
              </g>;
            })}
            {selected && geometry.anchors.map((point, index) => <g key={index}>
              <line className="world-map-link" x1={selected.centre[0]} y1={selected.centre[1]} x2={point[0]} y2={point[1]} />
              <circle className={`world-map-anchor${index === anchorIndex ? ' is-selected' : ''}`} data-placement={selected.id} data-anchor={index} cx={point[0]} cy={point[1]} r={marker * 0.8}><title>Anchor {index + 1}: {point.map(round).join(', ')}</title></circle>
            </g>)}
          </svg>
        </div>
        <div className="world-map-hint"><span>Drag a pin to move it · small dots adjust one anchor · scroll to zoom, drag space to pan</span><span>{Math.round(view.x)}, {Math.round(view.z)} · {Math.round(view.span)} m wide</span></div>
      </section>

      <aside className="world-inspector" aria-label="Inspector">
        {selected ? <section className="panel">
          <div className="panel-header"><MapPin size={13} /><h2>Placement</h2>
            <div className="panel-header-actions"><button type="button" className="button button-small" onClick={() => open('placements', selected.id)}><ArrowUpRight size={12} /> Open record</button></div>
          </div>
          <fieldset className="panel-body world-group" disabled={disabled}>
            <div className="world-id mono">{selected.id}</div>
            <Field label="Encounter"><select className="select" value={selected.encounterId} onChange={event => { patchPlacement(selected.id, { encounterId: event.target.value }); setEncounterId(event.target.value); }}>{!draft.encounters.some(row => row.id === selected.encounterId) && <option value={selected.encounterId}>{selected.encounterId}</option>}{draft.encounters.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
            <Field label="Region"><select className="select" value={selected.regionId} onChange={event => patchPlacement(selected.id, { regionId: event.target.value })}>{regions.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
            <div className="stat-grid">
              <StatInput label="Centre X" value={selected.centre[0]} onChange={x => patchPlacement(selected.id, { centre: [x, selected.centre[1]] })} />
              <StatInput label="Centre Z" value={selected.centre[1]} onChange={z => patchPlacement(selected.id, { centre: [selected.centre[0], z] })} />
              <StatInput label="Actors" min={1} max={64} step={1} value={selected.count} onChange={count => { const next = Math.max(1, Math.min(64, Math.round(count))); const anchors = (selected.anchorAdjustments ?? []).filter(a => a.index < next); if (selected.formation.kind === 'authored') for (let i = selected.count; i < next; i++) anchors.push({ index: i, offset: [i * selected.formation.spacing, 0] }); patchPlacement(selected.id, { count: next, anchorAdjustments: anchors }); setAnchorIndex(Math.min(anchorIndex, next - 1)); }} />
              <StatInput label="Radius m" min={0.01} value={selected.radius} onChange={radius => patchPlacement(selected.id, { radius })} />
            </div>
            <Field label="Formation">
              <div className="segmented">{(['grid', 'ring', 'authored'] as const).map(kind => <button type="button" key={kind} className={selected.formation.kind === kind ? 'is-active' : ''} onClick={() => patchPlacement(selected.id, { formation: { ...selected.formation, kind }, anchorAdjustments: kind === 'authored' ? geometry.anchors.map((point, index) => ({ index, offset: [point[0] - selected.centre[0], point[1] - selected.centre[1]] })) : [] })}>{kind === 'authored' ? 'Authored' : kind === 'grid' ? 'Grid' : 'Ring'}</button>)}</div>
            </Field>
            <div className="stat-grid">
              <StatInput label="Spacing m" min={0.01} value={selected.formation.spacing} onChange={spacing => patchPlacement(selected.id, { formation: { ...selected.formation, spacing } })} />
              <StatInput label="Rotation rad" value={selected.formation.rotation} onChange={rotation => patchPlacement(selected.id, { formation: { ...selected.formation, rotation } })} />
            </div>
            <Field label="Anchor"><select className="select" value={anchorIndex} onChange={event => setAnchorIndex(Number(event.target.value))}>{Array.from({ length: selected.count }, (_, index) => <option key={index} value={index}>Anchor {index + 1}{selected.anchorAdjustments?.some(a => a.index === index) ? ' · adjusted' : ''}</option>)}</select></Field>
            <div className="stat-grid">
              <StatInput label="Offset X" value={round(selectedOffset[0]!)} onChange={x => adjustAnchor(selected, anchorIndex, [x, selectedOffset[1]!])} />
              <StatInput label="Offset Z" value={round(selectedOffset[1]!)} onChange={z => adjustAnchor(selected, anchorIndex, [selectedOffset[0]!, z])} />
            </div>
            {geometry.error && <p className="world-feedback" role="alert">{geometry.error}</p>}
            {editable && <div className="world-actions">
              <button type="button" className="button button-small" disabled={selected.formation.kind === 'authored' || !selected.anchorAdjustments?.some(a => a.index === anchorIndex)} onClick={() => patchPlacement(selected.id, { anchorAdjustments: (selected.anchorAdjustments ?? []).filter(row => row.index !== anchorIndex) })}>Use generated anchor</button>
              <button type="button" className="button button-small button-danger" onClick={() => { edit({ ...draft, placements: draft.placements.filter(row => row.id !== selected.id) }); setSelectedId(''); }}>Remove</button>
            </div>}
          </fieldset>
        </section> : <section className="panel"><div className="panel-header"><MapPin size={13} /><h2>Placement</h2></div><p className="world-empty">Select a pin on the map or a row in the list.</p></section>}

        <section className="panel">
          <div className="panel-header"><Route size={13} /><h2>Encounter</h2>
            {encounter && <div className="panel-header-actions"><button type="button" className="button button-small" onClick={() => open('encounters', encounter.id)}><ArrowUpRight size={12} /> Open record</button></div>}
          </div>
          <fieldset className="panel-body world-group" disabled={disabled}>
            <select className="select" aria-label="Encounter definition" value={encounterId} onChange={event => setEncounterId(event.target.value)}><option value="">Choose encounter</option>{draft.encounters.map(row => <option key={row.id} value={row.id}>{row.name} · {row.id}</option>)}</select>
            {encounter && <>
              <label className="field-input world-text"><span>Name</span><input value={encounter.name} onChange={event => patchEncounter({ name: event.target.value })} /></label>
              <Field label="Activity"><div className="segmented">{ACTIVITIES.map(value => <button type="button" key={value} className={encounter.activity === value ? 'is-active' : ''} onClick={() => patchEncounter({ activity: value })}>{value}</button>)}</div></Field>
              <Field label={`Members · used by ${usedBy} placement${usedBy === 1 ? '' : 's'}`}>
                <div className="world-members">
                  {encounter.members.map((member, memberIndex) => <div className="stack-row" key={`${member.creatureId}:${memberIndex}`}>
                    <RefChip collection="creatureDefinitions" record={ctx.lookup('enemy', member.creatureId)} id={member.creatureId} ctx={ctx} onOpen={open} />
                    <input type="number" step="any" min={0.01} aria-label={`Weight of ${member.creatureId}`} title="Weight" value={member.weight} onChange={event => { const weight = event.target.valueAsNumber; if (Number.isFinite(weight)) patchEncounter({ members: encounter.members.map((row, i) => i === memberIndex ? { ...row, weight } : row) }); }} />
                    {editable && <RecordPicker collection="creatureDefinitions" value={member.creatureId} ctx={ctx} exclude={new Set([...memberIds].filter(id => id !== member.creatureId))} onPick={creatureId => patchEncounter({ members: encounter.members.map((row, i) => i === memberIndex ? { ...row, creatureId } : row) })} trigger={<button type="button" className="icon-button" aria-label="Change creature" title="Change creature"><Pencil size={12} /></button>} />}
                    {editable && <button type="button" className="icon-button" aria-label="Remove member" title="Remove member" disabled={encounter.members.length === 1} onClick={() => patchEncounter({ members: encounter.members.filter((_, i) => i !== memberIndex) })}><X size={12} /></button>}
                  </div>)}
                </div>
                {editable && <div className="world-actions"><RecordPicker collection="creatureDefinitions" ctx={ctx} exclude={memberIds} onPick={creatureId => patchEncounter({ members: [...encounter.members, { creatureId, weight: 1 }] })} trigger={<button type="button" className="button button-small"><Plus size={12} /> Add creature</button>} /></div>}
              </Field>
              {editable && <div className="world-actions"><button type="button" className="button button-small button-danger" disabled={usedBy > 0} title={usedBy > 0 ? 'Remove or reassign its placements first' : undefined} onClick={() => { edit({ ...draft, encounters: draft.encounters.filter(row => row.id !== encounter.id) }); setEncounterId(''); }}>Remove encounter</button></div>}
            </>}
          </fieldset>
        </section>

        {(preview || changes.length > 0) && <section className="panel world-preview">
          <div className="panel-header"><h2>Draft</h2><span className="count-badge">{changes.length} change{changes.length === 1 ? '' : 's'}</span></div>
          <div className="panel-body world-group">
            {preview && <details open><summary>{preview.affected.length} affected · {preview.diagnostics.length} diagnostics</summary>
              <ul>{preview.affected.map(row => <li key={`${row.collection}/${row.id}`}>{row.collection} / {row.id}</li>)}</ul>
              {preview.diagnostics.map((row, i) => <p key={i} className="world-diagnostic" data-severity={row.severity}>{row.severity}: {row.path} {row.message}</p>)}
            </details>}
            {changes.length > 0 && <details><summary>Source changes as JSON</summary><textarea readOnly aria-label="Draft transaction JSON" value={JSON.stringify(changes, null, 2)} /></details>}
          </div>
        </section>}
      </aside>
    </div>}
    {hover && hovered && createPortal(<div className="world-tip" style={{ left: Math.min(hover.x + 14, window.innerWidth - 250), top: Math.min(hover.y + 14, window.innerHeight - 90) }} role="presentation">
      <strong>{summarize('placements', asRow(hovered), ctx).title}</strong>
      <span>{regions.find(row => row.id === hovered.regionId)?.name ?? hovered.regionId} · {hovered.count} actor{hovered.count === 1 ? '' : 's'} · r {hovered.radius} m</span>
      <small className="mono">{hovered.id}</small>
    </div>, document.body)}
  </div>;
}
