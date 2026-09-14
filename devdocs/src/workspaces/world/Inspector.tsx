import { memo, type ReactNode } from "react";
import { ArrowUpRight, Crosshair, Plus, X } from "lucide-react";
import type { EncounterDefinition, ResourcePlacement, WorldPlacement } from "../../../../game/src/content/schema/encounters.js";
import type { ApiDiagnostic } from "../../../shared/contracts.js";
import type { ContentRow } from "../../model/contracts.js";
import type { SummaryContext } from "../../model/summaries.js";
import { rowName } from "../../model/rows.js";
import { RecordPicker } from "../../ui/RecordPicker.js";
import { RefChip } from "../../ui/RefChip.js";
import { Facts, NumberInput, Row, Section, Select, Sheet, Static, TextInput, Toggle } from "../../ui/Sheet.js";
import { glyphColor, glyphIcon } from "./glyphs.js";
import {
  ACTIVITIES, LOCATION_KINDS, OBSTACLE_INTERACTIONS, RANKS, authoredOffsets, detachEncounter, findOwned, patchEncounter, patchOwned, patchPlacement, patchResource, patchRegion, regionBounds, regionById, removeSelection, round, safeAnchors, titleCase,
  type Bank, type Bounds, type Building, type Draft, type Feature, type Gate, type Landmark, type Location, type NpcStand, type Obstacle, type Point, type Selection, type Shop, type Station,
} from "./model.js";

/*
  The right rail: one inspector per kind of thing, built from Sheet rows. Every edit goes through
  `update(draft => draft)` so the map, the list and the change count follow immediately.
*/

export interface InspectorProps {
  draft: Draft;
  selection: Selection | undefined;
  feature: Feature | undefined;
  editable: boolean;
  ctx: SummaryContext;
  encounterUses: ReadonlyMap<string, number>;
  diagnostics: readonly ApiDiagnostic[];
  update: (change: (draft: Draft) => Draft) => void;
  navigate: (collection?: string, id?: string) => void;
  onFit: (bounds: Bounds) => void;
  onSelect: (selection: Selection | undefined) => void;
}

const num = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const text = (value: unknown): string => typeof value === "string" ? value : "";
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export const Inspector = memo(function Inspector(props: InspectorProps) {
  const { selection, feature, diagnostics, draft } = props;
  return <aside className="world-rail world-rail-right" aria-label="Inspector">
    {diagnostics.length > 0 && <section className="world-diagnostics" role={diagnostics.some(row => row.severity === "error") ? "alert" : undefined}>
      <h3>{diagnostics.length === 1 ? "1 diagnostic" : `${diagnostics.length} diagnostics`}</h3>
      {diagnostics.slice(0, 40).map((row, index) => <p key={index} data-severity={row.severity}><code>{row.path}</code> {row.message}</p>)}
    </section>}
    {!selection || !feature ? <p className="world-empty">Click something on the map or in the list.</p> : <Body {...props} selection={selection} feature={feature} draft={draft} />}
  </aside>;
});

function Body(props: InspectorProps & { selection: Selection; feature: Feature }) {
  switch (props.selection.kind) {
    case "placement": return <PlacementSheet {...props} />;
    case "resource": return <ResourceSheet {...props} />;
    case "region": return <RegionSheet {...props} />;
    case "location": return <LocationSheet {...props} />;
    case "landmark": return <LandmarkSheet {...props} />;
    case "gate": return <GateSheet {...props} />;
    case "obstacle": return <ObstacleSheet {...props} />;
    case "npc": return <NpcSheet {...props} />;
    default: return <PieceSheet {...props} />;
  }
}

// ---------------------------------------------------------------- shared pieces

function Head({ feature, title, facts, aside }: { feature: Feature; title: ReactNode; facts: readonly (ReactNode | undefined | false)[]; aside?: ReactNode }) {
  const Icon = glyphIcon(feature);
  return <header className="world-head">
    <span className="world-row-glyph" style={{ background: glyphColor(feature, 40) }}><Icon size={12} /></span>
    <div className="world-head-body">
      <h2>{title}</h2>
      <Facts items={facts} />
      <code>{feature.key}</code>
    </div>
    {aside}
  </header>;
}

function PointRow({ label, value, onChange, disabled }: { label: string; value: readonly number[]; onChange: (point: Point) => void; disabled: boolean }) {
  return <Row label={label}>
    <NumberInput value={value[0]} ariaLabel={`${label} x`} disabled={disabled} onChange={x => onChange([x ?? 0, value[1] ?? 0])} />
    <NumberInput value={value[1]} ariaLabel={`${label} z`} disabled={disabled} onChange={z => onChange([value[0] ?? 0, z ?? 0])} />
    <span className="kv-unit">m</span>
  </Row>;
}

function Link({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" className="text-button" onClick={onClick}>{children}<ArrowUpRight size={11} /></button>;
}

function regionOptions(draft: Draft) { return draft.worldRegions.map(region => ({ value: region.id, label: region.name })); }

// ---------------------------------------------------------------- spawn

function PlacementSheet({ draft, selection, feature, editable, ctx, encounterUses, update, navigate, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const placement = draft.placements.find(row => row.id === selection.id);
  if (!placement) return null;
  const encounter = draft.encounters.find(row => row.id === placement.encounterId);
  const region = regionById(draft, placement.regionId);
  const uses = encounterUses.get(placement.encounterId) ?? 1;
  const disabled = !editable;
  const set = (patch: Partial<WorldPlacement>) => update(current => patchPlacement(current, placement.id, patch));
  const setEncounter = (patch: Partial<EncounterDefinition>) => encounter && update(current => patchEncounter(current, encounter.id, patch));
  const anchors = safeAnchors(placement);
  const adjustments = new Map(placement.anchorAdjustments?.map(row => [row.index, row.offset]));
  const setAnchor = (index: number, offset: Point) => { const entry: { index: number; offset: Point } = { index, offset: [round(offset[0]), round(offset[1])] }; set({ anchorAdjustments: [...(placement.anchorAdjustments ?? []).filter(row => row.index !== index), entry].sort((a, b) => a.index - b.index) }); };
  const setCount = (next: number | undefined) => {
    const count = Math.max(1, Math.min(64, Math.round(next ?? 1)));
    let anchorAdjustments = (placement.anchorAdjustments ?? []).filter(row => row.index < count);
    if (placement.formation.kind === "authored" && count > placement.count) {
      const generated = authoredOffsets({ ...placement, count, formation: { ...placement.formation, kind: "grid" } });
      anchorAdjustments = [...anchorAdjustments, ...generated.filter(row => row.index >= placement.count)];
    }
    set({ count, anchorAdjustments });
  };
  const setFormation = (kind: WorldPlacement["formation"]["kind"]) => {
    if (kind === placement.formation.kind) return;
    set({ formation: { ...placement.formation, kind }, anchorAdjustments: kind === "authored" ? authoredOffsets(placement) : [] });
  };
  const resetAnchors = () => set({ anchorAdjustments: placement.formation.kind === "authored" ? authoredOffsets({ ...placement, formation: { ...placement.formation, kind: "grid" } }) : [] });

  return <Sheet compact className="world-sheet">
    <Head feature={feature} title={editable ? <input className="world-title-input" value={encounter?.name ?? placement.encounterId} aria-label="Spawn name" onChange={event => setEncounter({ name: event.target.value })} /> : encounter?.name ?? placement.encounterId}
      facts={[region?.name ?? placement.regionId, encounter?.activity, `${placement.count} ${placement.count === 1 ? "actor" : "actors"}`, placement.rank && titleCase(placement.rank)]} />
    <Section title="Creatures">
      {encounter?.members.map((member, index) => {
        const record = ctx.lookup("enemy", member.creatureId);
        return <div className="world-member" key={member.creatureId}>
          <RefChip collection="creatureDefinitions" record={record} id={member.creatureId} ctx={ctx} onOpen={(_, id) => navigate("creatureDefinitions", id)} />
          {editable && <RecordPicker collection="creatureDefinitions" value={member.creatureId} ctx={ctx} exclude={new Set(encounter.members.filter(row => row.creatureId !== member.creatureId).map(row => row.creatureId))}
            onPick={(id, row) => setEncounter({ members: encounter.members.map((entry, i) => i === index ? { ...entry, creatureId: id } : entry), name: encounter.members.length === 1 ? rowName(row) : encounter.name })}
            trigger={<button type="button" className="button button-small button-ghost" aria-label="Change creature">Change</button>} />}
          <NumberInput value={member.weight} min={0.01} ariaLabel="Weight" disabled={disabled} onChange={weight => setEncounter({ members: encounter.members.map((entry, i) => i === index ? { ...entry, weight: weight ?? 1 } : entry) })} />
          {editable && <button type="button" className="icon-button" aria-label="Remove creature" disabled={encounter.members.length <= 1} onClick={() => setEncounter({ members: encounter.members.filter((_, i) => i !== index) })}><X size={12} /></button>}
        </div>;
      })}
      {!encounter && <Static muted>Encounter {placement.encounterId} is missing.</Static>}
      {editable && encounter && <RecordPicker collection="creatureDefinitions" ctx={ctx} exclude={new Set(encounter.members.map(row => row.creatureId))}
        onPick={id => setEncounter({ members: [...encounter.members, { creatureId: id, weight: 1 }] })}
        trigger={<button type="button" className="button button-small" aria-label="Add creature"><Plus size={12} /> Add creature</button>} />}
      {uses > 1 && <Row label="Shared"><Static>Shared with {uses - 1} other {uses - 1 === 1 ? "spawn" : "spawns"}</Static>{editable && <button type="button" className="button button-small" onClick={() => update(current => detachEncounter(current, placement.id))}>Detach</button>}</Row>}
    </Section>
    <Section title="Population">
      <Row label="Activity"><Select value={encounter?.activity} options={ACTIVITIES} disabled={disabled || !encounter} onChange={activity => setEncounter({ activity })} /></Row>
      <Row label="Count"><NumberInput value={placement.count} min={1} max={64} integer disabled={disabled} onChange={setCount} /></Row>
      <Row label="Radius"><NumberInput value={placement.radius} min={0.1} unit="m" disabled={disabled} onChange={radius => set({ radius: radius ?? placement.radius })} /></Row>
      <Row label="Rank"><Select value={placement.rank} options={RANKS} allowEmpty="none" disabled={disabled} onChange={rank => set({ rank: rank ? rank : undefined })} /></Row>
      <Row label="Level override"><NumberInput value={placement.level} min={1} integer placeholder="auto" disabled={disabled} onChange={level => set({ level })} /></Row>
    </Section>
    <Section title="Formation">
      <Row label="Kind"><span className="segmented">{(["grid", "ring", "authored"] as const).map(kind => <button type="button" key={kind} className={placement.formation.kind === kind ? "is-active" : ""} disabled={disabled} onClick={() => setFormation(kind)}>{titleCase(kind)}</button>)}</span></Row>
      {placement.formation.kind !== "authored" && <>
        <Row label="Spacing"><NumberInput value={placement.formation.spacing} min={0.1} unit="m" disabled={disabled} onChange={spacing => set({ formation: { ...placement.formation, spacing: spacing ?? placement.formation.spacing } })} /></Row>
        <Row label="Rotation"><NumberInput value={placement.formation.rotation} unit="rad" disabled={disabled} onChange={rotation => set({ formation: { ...placement.formation, rotation: rotation ?? 0 } })} /></Row>
      </>}
      <Row label="Anchors" align="start">
        <div className="world-anchor-list">
          {anchors.map((anchor, index) => {
            const raw = adjustments.get(index); const offset: Point = raw ? [round(raw[0]), round(raw[1])] : [round(anchor[0] - placement.centre[0]), round(anchor[1] - placement.centre[1])];
            return <div className="world-anchor" key={index} data-adjusted={adjustments.has(index) ? "true" : undefined}>
              <span className="world-anchor-index">{index + 1}</span>
              <NumberInput value={offset[0]} ariaLabel={`Anchor ${index + 1} x`} disabled={disabled} onChange={x => setAnchor(index, [x ?? 0, offset[1] ?? 0])} />
              <NumberInput value={offset[1]} ariaLabel={`Anchor ${index + 1} z`} disabled={disabled} onChange={z => setAnchor(index, [offset[0] ?? 0, z ?? 0])} />
            </div>;
          })}
          {editable && <button type="button" className="button button-small button-ghost" onClick={resetAnchors}>Reset to formation</button>}
        </div>
      </Row>
    </Section>
    <Section title="Placement">
      <Row label="Region"><Select value={placement.regionId} options={regionOptions(draft)} disabled={disabled} onChange={regionId => set({ regionId })} /></Row>
      <PointRow label="Centre" value={placement.centre} disabled={disabled} onChange={centre => set({ centre })} />
      {placement.habitatId && <Row label="Habitat"><Static mono>{placement.habitatId}</Static></Row>}
      <Row label="Dressing" align="start">{placement.dressing.length ? <Static mono muted>{placement.dressing.map(row => row.assetId).join(", ")}</Static> : <Static muted>None</Static>}</Row>
    </Section>
    {editable && <div className="world-actions">
      <button type="button" className="button button-small button-danger" aria-label="Remove spawn" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove spawn</button>
    </div>}
  </Sheet>;
}

// ---------------------------------------------------------------- resource node

function ResourceSheet({ draft, selection, feature, editable, ctx, update, navigate, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const node = draft.resourcePlacements.find(row => row.id === selection.id);
  if (!node) return null;
  const region = regionById(draft, node.regionId);
  const resource = ctx.lookup("resource", node.resourceId);
  const disabled = !editable;
  const set = (patch: Partial<ResourcePlacement>) => update(current => patchResource(current, node.id, patch));
  return <Sheet compact className="world-sheet">
    <Head feature={feature} title={resource ? rowName(resource) : node.resourceId} facts={[region?.name ?? node.regionId, text(resource?.archetype) && titleCase(text(resource?.archetype)), `${node.count} nodes`]} />
    <Section title="Resource">
      <Row label="Resource">
        <RefChip collection="resources" record={resource} id={node.resourceId} ctx={ctx} onOpen={(_, id) => navigate("resources", id)} />
        {editable && <RecordPicker collection="resources" value={node.resourceId} ctx={ctx} onPick={id => set({ resourceId: id })} trigger={<button type="button" className="button button-small button-ghost" aria-label="Change resource">Change</button>} />}
      </Row>
      <Row label="Count"><NumberInput value={node.count} min={1} integer disabled={disabled} onChange={count => set({ count: Math.max(1, Math.round(count ?? 1)) })} /></Row>
      <Row label="Radius"><NumberInput value={node.radius} min={0} unit="m" disabled={disabled} onChange={radius => set({ radius: radius ?? node.radius })} /></Row>
      {node.ringRadius !== undefined && <Row label="Ring radius"><NumberInput value={node.ringRadius} min={0} unit="m" disabled={disabled} onChange={ringRadius => set({ ringRadius })} /></Row>}
    </Section>
    <Section title="Placement">
      <Row label="Region"><Select value={node.regionId} options={regionOptions(draft)} disabled={disabled} onChange={regionId => set({ regionId })} /></Row>
      <Row label="Location"><Select value={node.locationId} options={(region?.locations ?? []).map(row => ({ value: row.id, label: row.name }))} disabled={disabled} onChange={locationId => set({ locationId })} /></Row>
      <PointRow label="Centre" value={node.centre} disabled={disabled} onChange={centre => set({ centre })} />
    </Section>
    {editable && <div className="world-actions"><button type="button" className="button button-small button-danger" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove node</button></div>}
  </Sheet>;
}

// ---------------------------------------------------------------- region

function RegionSheet({ draft, selection, feature, editable, update, onFit }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.id);
  if (!region) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchRegion(current, region.id, path, value));
  const spawns = draft.placements.filter(row => row.regionId === region.id).length;
  const nodes = draft.resourcePlacements.filter(row => row.regionId === region.id).length;
  const npcs = region.settlement?.npcs.length ?? 0;
  return <Sheet compact className="world-sheet">
    <Head feature={feature} title={region.name} facts={[`Tier ${region.tier}`, `${region.locations.length} locations`, `${spawns} spawns`, `${nodes} nodes`, `${npcs} NPCs`]}
      aside={<button type="button" className="button button-small" onClick={() => onFit(regionBounds(region))}><Crosshair size={12} /> Fit</button>} />
    <Section title="Region">
      <Row label="Name"><TextInput value={region.name} disabled={disabled} onChange={name => set(["name"], name)} /></Row>
      <Row label="Tier"><NumberInput value={region.tier} integer min={1} disabled={disabled} onChange={tier => set(["tier"], tier ?? region.tier)} /></Row>
      <PointRow label="Bounds min" value={region.bounds.min} disabled={disabled} onChange={point => set(["bounds", "min"], point)} />
      <PointRow label="Bounds max" value={region.bounds.max} disabled={disabled} onChange={point => set(["bounds", "max"], point)} />
      <PointRow label="Spawn point" value={region.spawnPoint} disabled={disabled} onChange={point => set(["spawnPoint"], point)} />
      <Row label="Respawn at"><Static mono>{region.respawnPointId}</Static></Row>
      {region.settlement && <Row label="Settlement"><Static>{region.settlement.name}</Static></Row>}
    </Section>
    <Section title="Lore"><Row label="Lore" wide><TextInput value={region.lore} multiline disabled={disabled} onChange={lore => set(["lore"], lore)} /></Row></Section>
  </Sheet>;
}

// ---------------------------------------------------------------- location

function LocationSheet({ draft, selection, feature, editable, update, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const location = region && findOwned(region, "location", selection.id) as Location | undefined;
  if (!region || !location) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  const roads = region.roads.filter(road => road.from === location.id || road.to === location.id).map(road => { const otherId = road.from === location.id ? road.to : road.from; return { id: otherId, name: region.locations.find(row => row.id === otherId)?.name ?? otherId, meters: road.meters }; });
  return <Sheet compact className="world-sheet">
    <Head feature={feature} title={location.name} facts={[titleCase(location.kind), region.name, location.routeNode && "Route node"]} />
    <Section title="Location">
      <Row label="Name"><TextInput value={location.name} disabled={disabled} onChange={name => set(["name"], name)} /></Row>
      <Row label="Kind"><Select value={location.kind} options={LOCATION_KINDS} disabled={disabled} onChange={kind => set(["kind"], kind)} /></Row>
      <PointRow label="Position" value={location.position} disabled={disabled} onChange={point => set(["position"], point)} />
      <Row label="Route node"><Toggle value={location.routeNode} disabled={disabled} onChange={value => set(["routeNode"], value)} /></Row>
      <Row label="Blurb" wide><TextInput value={location.blurb ?? ""} multiline disabled={disabled} onChange={blurb => set(["blurb"], blurb || undefined)} /></Row>
    </Section>
    <Section title="Roads">
      {roads.length ? roads.map(road => <Row key={road.id} label={road.name}><Link onClick={() => onSelect({ kind: "location", id: road.id, regionId: region.id })}>{road.meters ? `${road.meters} m` : "open"}</Link></Row>) : <Static muted>No roads touch this location.</Static>}
    </Section>
    {editable && <div className="world-actions"><button type="button" className="button button-small button-danger" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove location</button></div>}
  </Sheet>;
}

// ---------------------------------------------------------------- landmark

function LandmarkSheet({ draft, selection, feature, editable, ctx, update, navigate, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const landmark = region && findOwned(region, "landmark", selection.id) as Landmark | undefined;
  if (!region || !landmark) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  return <Sheet compact className="world-sheet">
    <Head feature={feature} title={landmark.name} facts={[region.name, landmark.assetId, landmark.solid && "Solid"]} />
    <Section title="Landmark">
      <Row label="Name"><TextInput value={landmark.name} disabled={disabled} onChange={name => set(["name"], name)} /></Row>
      <Row label="Asset">
        <RefChip collection="assets" record={ctx.lookup("asset", landmark.assetId)} id={landmark.assetId} ctx={ctx} onOpen={(_, id) => navigate("assets", id)} />
        {editable && <RecordPicker collection="assets" value={landmark.assetId} ctx={ctx} onPick={id => set(["assetId"], id)} trigger={<button type="button" className="button button-small button-ghost" aria-label="Change asset">Change</button>} />}
      </Row>
      <Row label="Scale"><NumberInput value={landmark.scale} min={0.01} disabled={disabled} onChange={scale => set(["scale"], scale)} /></Row>
      <Row label="Rotation"><NumberInput value={landmark.rotationY} unit="rad" disabled={disabled} onChange={rotation => set(["rotationY"], rotation)} /></Row>
      <Row label="Solid"><Toggle value={landmark.solid ?? false} disabled={disabled} onChange={value => set(["solid"], value || undefined)} /></Row>
      <PointRow label="Position" value={landmark.position} disabled={disabled} onChange={point => set(["position"], point)} />
      {landmark.composition && <Row label="Composition"><Static mono>{landmark.composition}</Static></Row>}
      <Row label="Blurb" wide><TextInput value={landmark.blurb} multiline disabled={disabled} onChange={blurb => set(["blurb"], blurb)} /></Row>
    </Section>
    {editable && <div className="world-actions"><button type="button" className="button button-small button-danger" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove landmark</button></div>}
  </Sheet>;
}

// ---------------------------------------------------------------- gate

function GateSheet({ draft, selection, feature, editable, update, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const gate = region && findOwned(region, "gate", selection.id) as Gate | undefined;
  if (!region || !gate) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  const target = regionById(draft, gate.toRegionId);
  return <Sheet compact className="world-sheet">
    <Head feature={feature} title={gate.name} facts={[region.name, `to ${target?.name ?? gate.toRegionId}`]} />
    <Section title="Gate">
      <Row label="Name"><TextInput value={gate.name} disabled={disabled} onChange={name => set(["name"], name)} /></Row>
      <Row label="To region"><Select value={gate.toRegionId} options={regionOptions(draft)} disabled={disabled} onChange={id => set(["toRegionId"], id)} /></Row>
      <Row label="To location">
        <Select value={gate.toLocationId} options={(target?.locations ?? []).map(row => ({ value: row.id, label: row.name }))} disabled={disabled} onChange={id => set(["toLocationId"], id)} />
        {target && target.locations.some(row => row.id === gate.toLocationId) && <Link onClick={() => onSelect({ kind: "location", id: gate.toLocationId, regionId: target.id })}>Show</Link>}
      </Row>
      <PointRow label="Position" value={gate.position} disabled={disabled} onChange={point => set(["position"], point)} />
      <Row label="Rotation"><NumberInput value={gate.rotationY} unit="rad" disabled={disabled} onChange={rotation => set(["rotationY"], rotation)} /></Row>
      <Row label="Asset"><Static mono>{gate.assetId}</Static></Row>
    </Section>
    {editable && <div className="world-actions"><button type="button" className="button button-small button-danger" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove gate</button></div>}
  </Sheet>;
}

// ---------------------------------------------------------------- obstacle

function ObstacleSheet({ draft, selection, feature, editable, update, onSelect }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const obstacle = region && findOwned(region, "obstacle", selection.id) as Obstacle | undefined;
  if (!region || !obstacle) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  const locationName = (id: string) => region.locations.find(row => row.id === id)?.name ?? id;
  return <Sheet compact className="world-sheet">
    <Head feature={feature} title={obstacle.name} facts={[titleCase(obstacle.interaction), `level ${obstacle.reqLevel}`, region.name]} />
    <Section title="Obstacle">
      <Row label="Name"><TextInput value={obstacle.name} disabled={disabled} onChange={name => set(["name"], name)} /></Row>
      <Row label="Interaction"><Select value={obstacle.interaction} options={OBSTACLE_INTERACTIONS} disabled={disabled} onChange={value => set(["interaction"], value)} /></Row>
      <Row label="Required level"><NumberInput value={obstacle.reqLevel} integer min={1} disabled={disabled} onChange={level => set(["reqLevel"], level ?? 1)} /></Row>
      <Row label="Duration"><NumberInput value={obstacle.durationMs} integer min={0} unit="ms" disabled={disabled} onChange={value => set(["durationMs"], value ?? 0)} /></Row>
      <Row label="Saves"><NumberInput value={obstacle.savesMeters} min={0} unit="m" disabled={disabled} onChange={value => set(["savesMeters"], value ?? 0)} /></Row>
      <Row label="One way"><Toggle value={obstacle.oneWay ?? false} disabled={disabled} onChange={value => set(["oneWay"], value || undefined)} /></Row>
      <PointRow label="Position" value={obstacle.position} disabled={disabled} onChange={point => set(["position"], point)} />
      <PointRow label="Exit" value={obstacle.exitPosition} disabled={disabled} onChange={point => set(["exitPosition"], point)} />
      <Row label="From"><Link onClick={() => onSelect({ kind: "location", id: obstacle.fromLocationId, regionId: region.id })}>{locationName(obstacle.fromLocationId)}</Link></Row>
      <Row label="To"><Link onClick={() => onSelect({ kind: "location", id: obstacle.toLocationId, regionId: region.id })}>{locationName(obstacle.toLocationId)}</Link></Row>
      <Row label="Asset"><Static mono>{obstacle.assetId}</Static></Row>
    </Section>
    {editable && <div className="world-actions"><button type="button" className="button button-small button-danger" onClick={() => { update(current => removeSelection(current, selection)); onSelect(undefined); }}>Remove obstacle</button></div>}
  </Sheet>;
}

// ---------------------------------------------------------------- npc stand

function NpcSheet({ draft, selection, feature, editable, ctx, update, navigate }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const stand = region && findOwned(region, "npc", selection.id) as NpcStand | undefined;
  if (!region || !stand) return null;
  const npc = ctx.lookup("npc", stand.id);
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  const quests = [...new Set([...stand.questIds, ...strings(npc?.questIds)])];
  const dialogueRootId = stand.dialogueRootId || text(npc?.dialogueRootId);
  return <Sheet compact className="world-sheet">
    <Head feature={feature} title={npc ? rowName(npc) : stand.name} facts={[region.settlement?.name, quests.length ? `${quests.length} ${quests.length === 1 ? "quest" : "quests"}` : undefined]} />
    <Section title="NPC">
      <Row label="Name"><TextInput value={stand.name} disabled={disabled} onChange={name => set(["name"], name)} /></Row>
      {npc && <Row label="Role" align="start"><Static>{text(npc.role)}</Static></Row>}
      <PointRow label="Position" value={stand.position} disabled={disabled} onChange={point => set(["position"], point)} />
      <Row label="Facing"><NumberInput value={stand.facingRad} unit="rad" disabled={disabled} onChange={value => set(["facingRad"], value ?? 0)} /></Row>
      <Row label="Asset">
        <RefChip collection="assets" record={ctx.lookup("asset", stand.assetId)} id={stand.assetId} ctx={ctx} onOpen={(_, id) => navigate("assets", id)} />
        {editable && <RecordPicker collection="assets" value={stand.assetId} ctx={ctx} onPick={id => set(["assetId"], id)} trigger={<button type="button" className="button button-small button-ghost" aria-label="Change asset">Change</button>} />}
      </Row>
    </Section>
    <Section title="Story">
      <Row label="Record">{npc ? <Link onClick={() => navigate("npcs", stand.id)}>Open NPC</Link> : <Static muted>No npcs.json record for {stand.id}</Static>}</Row>
      <Row label="Dialogue">{dialogueRootId ? <Link onClick={() => navigate("dialogue", dialogueRootId)}>{dialogueRootId}</Link> : <Static muted>None</Static>}</Row>
      <Row label="Quests" align="start">{quests.length ? <span className="world-links">{quests.map(id => <Link key={id} onClick={() => navigate("quests", id)}>{id}</Link>)}</span> : <Static muted>None</Static>}</Row>
    </Section>
  </Sheet>;
}

// ---------------------------------------------------------------- building / station / shop / bank

function PieceSheet({ draft, selection, feature, editable, ctx, update, navigate }: InspectorProps & { selection: Selection; feature: Feature }) {
  const region = regionById(draft, selection.regionId);
  const piece = region && findOwned(region, selection.kind, selection.id) as (Building | Station | Shop | Bank) | undefined;
  if (!region || !piece) return null;
  const disabled = !editable;
  const set = (path: (string | number)[], value: unknown) => update(current => patchOwned(current, selection, path, value));
  const building = selection.kind === "building" ? piece as Building : undefined;
  const station = selection.kind === "station" ? piece as Station : undefined;
  const shop = selection.kind === "shop" ? piece as Shop : undefined;
  const shopRecord = shop ? ctx.lookup("shop", shop.id) : undefined;
  const kind = building ? titleCase(building.prefab) : station ? `${titleCase(station.kind)} · ${station.skill}` : shop ? `${titleCase(shop.shopKind)} shop` : "Bank";
  return <Sheet compact className="world-sheet">
    <Head feature={feature} title={piece.name} facts={[kind, region.settlement?.name ?? region.name]} />
    <Section title={titleCase(selection.kind)}>
      <Row label="Name"><TextInput value={piece.name} disabled={disabled} onChange={name => set(["name"], name)} /></Row>
      {building && <Row label="Prefab"><TextInput value={building.prefab} width="id" mono disabled={disabled} onChange={value => set(["prefab"], value)} /></Row>}
      {station && <Row label="Kind"><Static>{titleCase(station.kind)} · {station.skill}</Static></Row>}
      {station?.essenceElement && <Row label="Element"><Static>{titleCase(station.essenceElement)}</Static></Row>}
      {shop && <Row label="Shop">{shopRecord ? <Link onClick={() => navigate("shops", shop.id)}>{rowName(shopRecord)}</Link> : <Static muted>No shops.json record for {shop.id}</Static>}</Row>}
      <PointRow label="Position" value={piece.position} disabled={disabled} onChange={point => set(["position"], point)} />
      <Row label="Rotation"><NumberInput value={piece.rotationY} unit="rad" disabled={disabled} onChange={value => set(["rotationY"], value ?? 0)} /></Row>
      {building && <Row label="Footprint">
        <NumberInput value={building.footprint[0]} min={0.1} ariaLabel="Footprint width" disabled={disabled} onChange={value => set(["footprint"], [value ?? 1, building.footprint[1]])} />
        <NumberInput value={building.footprint[1]} min={0.1} ariaLabel="Footprint depth" disabled={disabled} onChange={value => set(["footprint"], [building.footprint[0], value ?? 1])} />
        <span className="kv-unit">m</span>
      </Row>}
      {!building && "assetId" in piece && <Row label="Asset">
        <RefChip collection="assets" record={ctx.lookup("asset", piece.assetId)} id={piece.assetId} ctx={ctx} onOpen={(_, id) => navigate("assets", id)} />
        {editable && <RecordPicker collection="assets" value={piece.assetId} ctx={ctx} onPick={id => set(["assetId"], id)} trigger={<button type="button" className="button button-small button-ghost" aria-label="Change asset">Change</button>} />}
      </Row>}
      {"attachedTo" in piece && piece.attachedTo && <Row label="Attached to"><Link onClick={() => navigate("world/map", `buildings:${region.id}/${piece.attachedTo}`)}>{region.settlement?.buildings.find(row => row.id === piece.attachedTo)?.name ?? piece.attachedTo}</Link></Row>}
      {station && <Row label="Recipes" align="start">{station.recipeIds.length ? <span className="world-links">{station.recipeIds.map(id => <Link key={id} onClick={() => navigate("recipes", id)}>{id}</Link>)}</span> : <Static muted>None</Static>}</Row>}
      {station?.scale !== undefined && <Row label="Scale"><NumberInput value={num(station.scale)} min={0.01} disabled={disabled} onChange={value => set(["scale"], value)} /></Row>}
    </Section>
  </Sheet>;
}
