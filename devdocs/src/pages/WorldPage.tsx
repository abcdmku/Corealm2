import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../api/client.js';
import type { CollectionResponse, ContentOperation, ContentTransactionRequest, ContentTransactionResponse } from '../../shared/contracts.js';
import type { EncounterDefinition, WorldPlacement } from '../../../game/src/content/schema/encounters.js';
import { placementAnchors } from '../../../game/src/content/worldCompiler.js';
import regions from '../../../game/content/data/worldRegions.json';
import './worldPage.css';

type Draft = { encounters: EncounterDefinition[]; placements: WorldPlacement[] };
type Snapshot = { draft: Draft; revisions: Record<string, string> };
type View = { x: number; z: number; span: number };
const empty: Draft = { encounters: [], placements: [] };
const round = (value: number) => Math.round(value * 100) / 100;
function fit(rows: WorldPlacement[]): View {
  if (!rows.length) return { x: 0, z: 0, span: 100 };
  const left = Math.min(...rows.map(p => p.centre[0] - p.radius));
  const right = Math.max(...rows.map(p => p.centre[0] + p.radius));
  const top = Math.min(...rows.map(p => p.centre[1] - p.radius));
  const bottom = Math.max(...rows.map(p => p.centre[1] + p.radius));
  return { x: (left + right) / 2, z: (top + bottom) / 2, span: Math.max(40, right - left, (bottom - top) * 4 / 3) * 1.2 };
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
function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) {
  return <label>{label}<input aria-label={label} type="number" step="any" min={min} max={max} value={value} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) onChange(next); }} /></label>;
}

export function WorldPage() {
  const queryClient = useQueryClient();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [draft, setDraft] = useState<Draft>(empty);
  const [creatures, setCreatures] = useState<{ id: string; name?: string }[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [encounterId, setEncounterId] = useState('');
  const [newId, setNewId] = useState('');
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [view, setView] = useState<View>({ x: 0, z: 0, span: 100 });
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<ContentTransactionResponse>();
  const drag = useRef<{ id: string; anchor?: number; start: [number, number]; centre: [number, number]; offset: [number, number] } | undefined>(undefined);
  const svg = useRef<SVGSVGElement>(null);
  const selected = draft.placements.find(row => row.id === selectedId);
  const encounter = draft.encounters.find(row => row.id === encounterId);
  const changes = useMemo(() => snapshot ? operations(snapshot.draft, draft) : [], [snapshot, draft]);
  const filtered = draft.placements.filter(row => (!region || row.regionId === region) && `${row.id} ${row.encounterId}`.toLowerCase().includes(search.toLowerCase()));
  const geometry = useMemo(() => {
    try { return { anchors: selected ? placementAnchors(selected) : [], error: '' }; }
    catch (reason) { return { anchors: [] as [number, number][], error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [selected]);
  const editable = !__DEVDOCS_PLAYER__;

  useEffect(() => {
    let active = true;
    Promise.all(['encounters', 'placements', 'creatureDefinitions'].map(name => apiGet<CollectionResponse>(`collections/${name}`))).then(([encounters, placements, creatureRows]) => {
      if (!active) return;
      const initial = { encounters: encounters!.data as EncounterDefinition[], placements: placements!.data as WorldPlacement[] };
      setSnapshot({ draft: structuredClone(initial), revisions: { encounters: encounters!.revision, placements: placements!.revision, creatureDefinitions: creatureRows!.revision } });
      setDraft(initial); setCreatures(creatureRows!.data as { id: string; name?: string }[]);
      setSelectedId(initial.placements[0]?.id ?? ''); setEncounterId(initial.placements[0]?.encounterId ?? initial.encounters[0]?.id ?? '');
      setView(fit(initial.placements));
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!changes.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changes.length]);
  function edit(next: Draft | ((previous: Draft) => Draft)) { setDraft(next); setPreview(undefined); setNotice(''); }
  function patchPlacement(id: string, patch: Partial<WorldPlacement>) { edit(previous => ({ ...previous, placements: previous.placements.map(row => row.id === id ? { ...row, ...patch } : row) })); }
  function patchEncounter(patch: Partial<EncounterDefinition>) { if (encounter) edit(previous => ({ ...previous, encounters: previous.encounters.map(row => row.id === encounter.id ? { ...row, ...patch } : row) })); }
  function choose(row: WorldPlacement) { setSelectedId(row.id); setEncounterId(row.encounterId); setAnchorIndex(0); }
  function adjustAnchor(row: WorldPlacement, index: number, offset: [number, number]) {
    patchPlacement(row.id, { anchorAdjustments: [...(row.anchorAdjustments ?? []).filter(a => a.index !== index), { index, offset }].sort((a, b) => a.index - b.index) });
  }
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
      edit({ ...draft, placements: [...draft.placements, row] }); choose(row); setView(fit([row]));
    }
    setNewId('');
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
  function mapPoint(event: PointerEvent<SVGSVGElement>): [number, number] {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return [0, 0];
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [point.x, point.y];
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    const target = (event.target as Element).closest('[data-placement]');
    const row = draft.placements.find(p => p.id === target?.getAttribute('data-placement'));
    if (!row) return;
    choose(row);
    if (!editable || busy) return;
    const raw = target?.getAttribute('data-anchor');
    const anchor = raw !== null && raw !== undefined ? Number(raw) : undefined;
    if (anchor !== undefined) setAnchorIndex(anchor);
    drag.current = { id: row.id, anchor, start: mapPoint(event), centre: [...row.centre], offset: anchor === undefined ? [0, 0] : [placementAnchors(row)[anchor]![0] - row.centre[0], placementAnchors(row)[anchor]![1] - row.centre[1]] };
    event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (!active) return;
    const point = mapPoint(event);
    const delta = [point[0] - active.start[0], point[1] - active.start[1]];
    if (active.anchor === undefined) patchPlacement(active.id, { centre: [round(active.centre[0] + delta[0]!), round(active.centre[1] + delta[1]!)] });
    else {
      const row = draft.placements.find(p => p.id === active.id);
      if (row) adjustAnchor(row, active.anchor, [round(active.offset[0] + delta[0]!), round(active.offset[1] + delta[1]!)]);
    }
  }
  const selectedAnchor = geometry.anchors[anchorIndex];
  const selectedOffset = selected && selectedAnchor ? [selectedAnchor[0] - selected.centre[0], selectedAnchor[1] - selected.centre[1]] : [0, 0];
  const marker = view.span / 180;
  return <div className="world-page">
    <header className="page-heading"><h1>World</h1><p>Compose encounters, place populations and adjust their generated anchors.</p></header>
    {error && <div className="world-feedback" role="alert">{error}</div>}
    {!snapshot ? <p role="status">Loading world sources...</p> : <>
      <div className="world-toolbar">
        <label>Find placement<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label>Region<select value={region} onChange={event => setRegion(event.target.value)}><option value="">All regions</option>{regions.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <span>{filtered.length} placements · {draft.placements.reduce((sum, row) => sum + row.count, 0)} actors</span>
        {editable && <><button className="button" disabled={!changes.length || busy} onClick={() => void submit('preview')}>Preview changes</button><button className="button world-save" disabled={!changes.length || busy} onClick={() => void submit('save')}>{busy ? 'Validating...' : `Save${changes.length ? ` ${changes.length} changes` : ''}`}</button><button className="button" disabled={!changes.length || busy} onClick={() => { edit(structuredClone(snapshot.draft)); setError(''); }}>Discard draft</button></>}
      </div>
      {notice && <p className="world-feedback" role="status">{notice}</p>}
      {preview && <details className="world-preview" open><summary>{preview.affected.length} affected records · {preview.diagnostics.length} diagnostics</summary><ul>{preview.affected.map(row => <li key={`${row.collection}/${row.id}`}>{row.collection} / {row.id}</li>)}</ul>{preview.diagnostics.map((row, index) => <p key={index}>{row.severity}: {row.path} {row.message}</p>)}</details>}
      <div className="world-layout">
        <aside className="world-list" aria-label="Placements">{filtered.map(row => <button key={row.id} aria-pressed={selectedId === row.id} onClick={() => choose(row)}><strong>{row.id}</strong><span>{row.regionId} · {row.count} actors</span></button>)}{!filtered.length && <p>No placements match.</p>}</aside>
        <section className="world-map-panel">
          <div className="world-map-tools"><button className="button" onClick={() => setView(fit(filtered))}>Fit region</button><button className="button" disabled={!selected} onClick={() => selected && setView(fit([selected]))}>Focus placement</button><button className="button" aria-label="Zoom in" onClick={() => setView(v => ({ ...v, span: Math.max(10, v.span / 1.5) }))}>+</button><button className="button" aria-label="Zoom out" onClick={() => setView(v => ({ ...v, span: Math.min(10000, v.span * 1.5) }))}>−</button></div>
          <svg ref={svg} className="world-map" viewBox={`${view.x - view.span / 2} ${view.z - view.span * 3 / 8} ${view.span} ${view.span * 3 / 4}`} role="img" aria-label="Encounter placement map. Drag a centre to move its population; drag a small anchor to adjust one actor." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
            {regions.map(row => <g key={row.id} className="world-map-region"><rect x={row.bounds.min[0]} y={row.bounds.min[1]} width={row.bounds.max[0]! - row.bounds.min[0]!} height={row.bounds.max[1]! - row.bounds.min[1]!} /><text x={row.bounds.min[0]! + marker * 2} y={row.bounds.min[1]! + marker * 5} fontSize={marker * 3}>{row.name}</text></g>)}
            {filtered.map(row => <g key={row.id} className={row.id === selectedId ? 'world-map-placement is-selected' : 'world-map-placement'}><circle className="world-map-radius" cx={row.centre[0]} cy={row.centre[1]} r={row.radius} /><circle data-placement={row.id} cx={row.centre[0]} cy={row.centre[1]} r={marker * 1.6}><title>{row.id}, {row.count} actors</title></circle></g>)}
            {selected && geometry.anchors.map((point, index) => <g key={index}><line className="world-map-link" x1={selected.centre[0]} y1={selected.centre[1]} x2={point[0]} y2={point[1]} /><circle className={`world-map-anchor${index === anchorIndex ? ' is-selected' : ''}`} data-placement={selected.id} data-anchor={index} cx={point[0]} cy={point[1]} r={marker}><title>Anchor {index + 1}: {point.join(', ')}</title></circle></g>)}
          </svg>
          <p className="world-map-caption">X → · Z ↓ · View {Math.round(view.span)} m wide. Large dots move a placement; small dots adjust one anchor. Map geometry uses the production formation compiler.</p>
          {geometry.error && <p role="alert">{geometry.error}</p>}
        </section>
        <fieldset className="world-inspector" disabled={!editable || busy}>
          <legend>Placement</legend>
          {selected ? <><h2>{selected.id}</h2><label>Encounter<select value={selected.encounterId} onChange={event => { patchPlacement(selected.id, { encounterId: event.target.value }); setEncounterId(event.target.value); }}>{draft.encounters.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label>Placement region<select value={selected.regionId} onChange={event => patchPlacement(selected.id, { regionId: event.target.value })}>{regions.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <div className="world-fields"><NumberField label="Centre X" value={selected.centre[0]} onChange={x => patchPlacement(selected.id, { centre: [x, selected.centre[1]] })} /><NumberField label="Centre Z" value={selected.centre[1]} onChange={z => patchPlacement(selected.id, { centre: [selected.centre[0], z] })} /><NumberField label="Population" min={1} max={64} value={selected.count} onChange={count => { const next = Math.max(1, Math.min(64, Math.round(count))); const anchors = (selected.anchorAdjustments ?? []).filter(a => a.index < next); if (selected.formation.kind === 'authored') for (let i = selected.count; i < next; i++) anchors.push({ index: i, offset: [i * selected.formation.spacing, 0] }); patchPlacement(selected.id, { count: next, anchorAdjustments: anchors }); setAnchorIndex(Math.min(anchorIndex, next - 1)); }} /><NumberField label="Radius" min={0.01} value={selected.radius} onChange={radius => patchPlacement(selected.id, { radius })} /></div>
            <label>Formation<select value={selected.formation.kind} onChange={event => { const kind = event.target.value as WorldPlacement['formation']['kind']; patchPlacement(selected.id, { formation: { ...selected.formation, kind }, anchorAdjustments: kind === 'authored' ? geometry.anchors.map((point, index) => ({ index, offset: [point[0] - selected.centre[0], point[1] - selected.centre[1]] })) : [] }); }}><option value="grid">Grid</option><option value="ring">Ring</option><option value="authored">Authored anchors</option></select></label>
            <div className="world-fields"><NumberField label="Spacing" min={0.01} value={selected.formation.spacing} onChange={spacing => patchPlacement(selected.id, { formation: { ...selected.formation, spacing } })} /><NumberField label="Rotation, radians" value={selected.formation.rotation} onChange={rotation => patchPlacement(selected.id, { formation: { ...selected.formation, rotation } })} /></div>
            <label>Anchor<select value={anchorIndex} onChange={event => setAnchorIndex(Number(event.target.value))}>{Array.from({ length: selected.count }, (_, index) => <option key={index} value={index}>Anchor {index + 1}</option>)}</select></label>
            <div className="world-fields"><NumberField label="Anchor offset X" value={selectedOffset[0]!} onChange={x => adjustAnchor(selected, anchorIndex, [x, selectedOffset[1]!])} /><NumberField label="Anchor offset Z" value={selectedOffset[1]!} onChange={z => adjustAnchor(selected, anchorIndex, [selectedOffset[0]!, z])} /></div>
            <button className="button" disabled={selected.formation.kind === 'authored'} onClick={() => patchPlacement(selected.id, { anchorAdjustments: (selected.anchorAdjustments ?? []).filter(row => row.index !== anchorIndex) })}>Use generated anchor</button><button className="button" onClick={() => { edit({ ...draft, placements: draft.placements.filter(row => row.id !== selected.id) }); setSelectedId(''); }}>Remove placement</button>
          </> : <p>Select a placement on the map or in the list.</p>}
        </fieldset>
      </div>
      <fieldset className="world-encounters" disabled={!editable || busy}><legend>Reusable encounter</legend>
        <label>Encounter definition<select value={encounterId} onChange={event => setEncounterId(event.target.value)}><option value="">Choose encounter</option>{draft.encounters.map(row => <option key={row.id} value={row.id}>{row.name} · {row.id}</option>)}</select></label>
        {encounter && <><div className="world-fields"><label>Name<input value={encounter.name} onChange={event => patchEncounter({ name: event.target.value })} /></label><label>Activity<select value={encounter.activity} onChange={event => patchEncounter({ activity: event.target.value as EncounterDefinition['activity'] })}>{['graze', 'forage', 'prowl', 'patrol'].map(value => <option key={value}>{value}</option>)}</select></label></div>
          <p>Used by {draft.placements.filter(row => row.encounterId === encounter.id).length} placements. Weights divide each placement's population among these creatures.</p>
          {encounter.members.map((member, index) => <div className="world-member" key={index}><label>Creature {index + 1}<select value={member.creatureId} onChange={event => patchEncounter({ members: encounter.members.map((row, i) => i === index ? { ...row, creatureId: event.target.value } : row) })}>{!creatures.some(row => row.id === member.creatureId) && <option value={member.creatureId}>{member.creatureId}</option>}{creatures.map(row => <option key={row.id} value={row.id}>{row.name ?? row.id} · {row.id}</option>)}</select></label><NumberField label={`Weight ${index + 1}`} value={member.weight} min={0.01} onChange={weight => patchEncounter({ members: encounter.members.map((row, i) => i === index ? { ...row, weight } : row) })} /><button className="button" disabled={encounter.members.length === 1} onClick={() => patchEncounter({ members: encounter.members.filter((_, i) => i !== index) })}>Remove member</button></div>)}
          <div className="world-actions"><button className="button" disabled={!creatures.some(c => !encounter.members.some(m => m.creatureId === c.id))} onClick={() => { const next = creatures.find(c => !encounter.members.some(m => m.creatureId === c.id)); if (next) patchEncounter({ members: [...encounter.members, { creatureId: next.id, weight: 1 }] }); }}>Add creature</button><button className="button" disabled={draft.placements.some(row => row.encounterId === encounter.id)} title="Remove or reassign all placements before removing their encounter" onClick={() => { edit({ ...draft, encounters: draft.encounters.filter(row => row.id !== encounter.id) }); setEncounterId(''); }}>Remove encounter</button></div>
        </>}
      </fieldset>
      {editable && <fieldset className="world-create" disabled={busy}><legend>Add content</legend><label>New ID<input value={newId} placeholder="moonlit_patrol" onChange={event => setNewId(event.target.value)} /></label><button className="button" onClick={() => add('encounter')}>Add encounter</button><button className="button" disabled={!encounterId} onClick={() => add('placement')}>Add placement</button></fieldset>}
      {changes.length > 0 && <details className="world-preview"><summary>Draft source changes, copy before reloading a conflict</summary><textarea readOnly aria-label="Draft transaction JSON" value={JSON.stringify(changes, null, 2)} /></details>}
    </>}
  </div>;
}


