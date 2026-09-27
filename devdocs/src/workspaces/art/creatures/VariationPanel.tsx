import { Button, NativeSelect } from "../../../components/ui/index.js";
import type { RecordDraft } from "../../../model/draft.js";
import { EditTable, NumberField, type TableColumn } from "../../../ui/field/index.js";
import type { Creature, CreatureData } from "../../creatures/shared.js";
import { formatRange, presentationOf, withPresentation, type Variation } from "./model.js";
import { Note, Row, Rows, Section } from "./parts.js";
import { skinMapUrl, type CreatureSkin } from "./skinApi.js";
import { DraftBar } from "./VariantPanel.js";

type RangeKey = "scale" | "saturation" | "value";
type PoolEntry = NonNullable<Variation["skins"]>[number];

const RANGES: readonly { key: RangeKey; label: string }[] = [
  { key: "scale", label: "Size" },
  { key: "saturation", label: "Saturation" },
  { key: "value", label: "Brightness" },
];

/** Drop empty parts so a cleared range leaves no `{}` behind. */
function tidy(variation: Variation): Variation | undefined {
  const next: Record<string, unknown> = { ...variation };
  for (const key of Object.keys(next)) if (next[key] === undefined || (Array.isArray(next[key]) && !(next[key] as unknown[]).length)) delete next[key];
  if (!next.skins) delete next.baseWeight;
  return Object.keys(next).length ? next as Variation : undefined;
}

/**
 * Individual variation on one definition (`presentation.variation`): how individuals of one herd
 * differ. Every individual rolls once from its entity id with the game's `rollCreatureLook`; the
 * stage's crowd shows the same rolls.
 */
export function VariationPanel({ draft, data, skins, crowd, onCrowd }: {
  draft: RecordDraft<Creature>; data: CreatureData; skins: readonly CreatureSkin[]; crowd: number; onCrowd: (count: number) => void;
}) {
  const working = draft.draft ?? draft.record;
  const base = working?.baseId ? data.byId.get(working.baseId) : undefined;
  const presentation = presentationOf(working, base);
  if (!working || !presentation) return <Section title="Variation"><Note>{working ? "This definition has no presentation to vary." : "Loading…"}</Note></Section>;
  const variation: Variation = presentation.variation ?? {};
  const readOnly = !draft.editable;
  const write = (next: Variation) => draft.set(current => withPresentation(current, base, { variation: tidy(next) }));
  const pool = variation.skins ?? [];
  const inherited = Boolean(working.baseId && !working.presentation && presentation.variation);

  const setRange = (key: RangeKey, index: 0 | 1, value: number | undefined) => {
    if (value === undefined) { write({ ...variation, [key]: undefined }); return; }
    const [low, high] = variation[key] ?? [1, 1];
    const next: [number, number] = index === 0 ? [value, Math.max(value, high)] : [Math.min(low, value), value];
    write({ ...variation, [key]: next });
  };

  const skinName = (id: string) => skins.find(skin => skin.id === id)?.name ?? id;
  const total = (variation.baseWeight ?? 1) + pool.reduce((sum, entry) => sum + entry.weight, 0);
  const share = (weight: number) => total > 0 ? `${Math.round(weight / total * 100)}%` : "–";
  const columns: TableColumn<PoolEntry>[] = [
    { key: "skin", header: "Skin", render: entry => {
      const skin = skins.find(row => row.id === entry.skinId);
      const map = skin && Object.values(skin.maps)[0];
      return <>
        <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-sm bg-art">{map && <img src={skinMapUrl(map)} alt="" className="size-full object-cover" />}</span>
        <span className="truncate" title={entry.skinId}>{skinName(entry.skinId)}</span>
      </>;
    } },
    { key: "weight", header: "Weight", render: (entry, api) => <NumberField value={entry.weight} min={0.01} step={0.5} readOnly={readOnly} ariaLabel={`Weight of ${skinName(entry.skinId)}`} onChange={value => value !== undefined && value > 0 && api.update({ ...entry, weight: value })} /> },
    { key: "share", header: "Share", align: "end", render: entry => <span className="text-faint tabular-nums">{share(entry.weight)}</span> },
  ];
  const addable = skins.filter(skin => !pool.some(entry => entry.skinId === skin.id));

  return <Section title="Individual variation" aside={presentation.variation && !readOnly ? <Button variant="ghost" size="xs" onClick={() => write({})}>Clear</Button> : undefined}>
    <Note>Each individual of {working.name ?? base?.name ?? working.id} rolls once inside these ranges, so a herd is not one creature copied. Empty means no spread.</Note>
    <Rows>
      {RANGES.slice(0, 1).map(range => <RangeRow key={range.key} label={range.label} value={variation[range.key]} readOnly={readOnly} onChange={(index, value) => setRange(range.key, index, value)} />)}
      <Row label="Hue">
        <span className="text-[11px] text-faint">±</span>
        <NumberField value={variation.hue} optional min={0} max={180} step={2} placeholder="–" unit="°" readOnly={readOnly} ariaLabel="Hue spread" onChange={value => write({ ...variation, hue: value || undefined })} />
        <span className="truncate text-[11px] text-faint">either way</span>
      </Row>
      {RANGES.slice(1).map(range => <RangeRow key={range.key} label={range.label} value={variation[range.key]} readOnly={readOnly} onChange={(index, value) => setRange(range.key, index, value)} />)}
    </Rows>
    <div className="mt-1 flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-muted-foreground">Skin pool</span>
      <Rows>
        <Row label="Own look">
          <NumberField value={variation.baseWeight ?? 1} min={0} step={0.5} readOnly={readOnly || !pool.length} ariaLabel="Own look weight" onChange={value => write({ ...variation, baseWeight: value === 1 ? undefined : value })} />
          <span className="text-[11px] text-faint tabular-nums">{pool.length ? share(variation.baseWeight ?? 1) : "every individual"}</span>
        </Row>
      </Rows>
      <EditTable<PoolEntry> label="Skin pool" items={pool} columns={columns} template="grid-cols-[minmax(0,1fr)_auto_2.5rem_auto]" readOnly={readOnly}
        keyOf={entry => entry.skinId} removeLabel={entry => `Remove ${skinName(entry.skinId)} from the pool`}
        emptyText={skins.length ? "None in the pool" : "This model has no skins yet"}
        onChange={items => write({ ...variation, skins: items })}
        addControl={!readOnly && addable.length ? <NativeSelect className="h-7 text-xs" aria-label="Add a skin to the pool" value="" onChange={event => { if (event.target.value) write({ ...variation, skins: [...pool, { skinId: event.target.value, weight: 1 }] }); }}>
          <option value="">Add skin…</option>
          {addable.map(skin => <option key={skin.id} value={skin.id}>{skin.name} ({skin.kind})</option>)}
        </NativeSelect> : undefined} />
    </div>
    {inherited && <Note>This range comes from the base. Editing it gives this variant its own copy.</Note>}
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-faint">Preview</span>
      <Button variant="secondary" size="xs" aria-pressed={crowd > 1} onClick={() => onCrowd(crowd > 1 ? 1 : 6)}>{crowd > 1 ? `Crowd of ${crowd} on stage` : "Show a crowd"}</Button>
      <span className="truncate text-[11px] text-faint">{summary(variation)}</span>
    </div>
    <DraftBar draft={draft} />
  </Section>;
}

function RangeRow({ label, value, readOnly, onChange }: { label: string; value: readonly [number, number] | undefined; readOnly: boolean; onChange: (index: 0 | 1, value: number | undefined) => void }) {
  return <Row label={label}>
    <NumberField value={value?.[0]} optional min={0.01} step={0.05} placeholder="–" readOnly={readOnly} ariaLabel={`${label} minimum`} onChange={next => onChange(0, next)} />
    <span className="text-[11px] text-faint">to</span>
    <NumberField value={value?.[1]} optional min={0.01} step={0.05} placeholder="–" readOnly={readOnly} ariaLabel={`${label} maximum`} onChange={next => onChange(1, next)} />
  </Row>;
}

function summary(variation: Variation): string {
  const parts = [
    variation.scale && `size ${formatRange(variation.scale)}`,
    variation.hue && `hue ±${variation.hue}°`,
    variation.saturation && `sat ${formatRange(variation.saturation)}`,
    variation.value && `bright ${formatRange(variation.value)}`,
    variation.skins?.length && `${variation.skins.length + 1} looks`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No spread yet";
}
