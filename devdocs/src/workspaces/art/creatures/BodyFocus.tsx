import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Segmented, Textarea } from "../../../components/ui/index.js";
import { cn } from "../../../lib/utils.js";
import { useArtDigest, useArtReview, type ArtSummary } from "../../../model/artReview.js";
import type { CreatureLook } from "../../../model/creatureArt.js";
import { useRecordDraft } from "../../../model/draft.js";
import { FocusLayout, StateStrip, StripRow, VerdictBar, VerdictDot, humanize, type StateItem } from "../../../ui/FocusLayout.js";
import { CreatureArt } from "./CreatureArt.js";
import { AssetViewer } from "../../../viewer/AssetViewer.js";
import { CREATURE_STATES, type ActorDraft, type ViewerAppearance, type ViewerSize, type ViewerSnapshot, type ViewerStateInfo } from "../../../viewer/types.js";
import type { ViewProps } from "../../types.js";
import { titleCase, type Creature, type CreatureData } from "../../creatures/shared.js";
import { AddVariantDrawer } from "./AddVariant.js";
import { BodyVerdict, Unreviewed } from "./BodyIndex.js";
import { lookLabel, presentationOf, skinPrompt, withPresentation, type BodyEntry } from "./model.js";
import { Legend, Pairs, Section, formatScale } from "./parts.js";
import { useCreatureSkins, useImagegenJobs } from "./skinApi.js";
import { SkinsPanel, type SkinsMode } from "./SkinsPanel.js";
import { VariantPanel } from "./VariantPanel.js";
import { VariationPanel } from "./VariationPanel.js";

/** The variant last looked at on each body, so coming back to a body lands on the same one. */
const lastVariant = new Map<string, string>();
export const rememberVariant = (assetId: string, creatureId: string) => { lastVariant.set(assetId, creatureId); };

type Panel = "review" | "variant" | "variation" | "skins";
const PANELS: readonly { value: Panel; label: string }[] = [{ value: "review", label: "Review" }, { value: "variant", label: "Variant" }, { value: "variation", label: "Variation" }, { value: "skins", label: "Skins" }];
/** The inspector panel stays picked while walking bodies. */
let lastPanel: Panel = "review";
const CROWD_SIZES = [3, 6, 12] as const;

const LAB_URL = "http://127.0.0.1:4173/index.html?mode=combat&creatures=1";

/** What the page keeps from the viewer's snapshot. The viewer reports every 120 ms; the page only redraws when these change. */
interface StageReadout { ready: boolean; states: ViewerStateInfo[]; state: string | null; size: ViewerSize | null; appearance: ViewerAppearance | null }
const EMPTY_READOUT: StageReadout = { ready: false, states: [], state: null, size: null, appearance: null };

const isEditable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function BodyFocus({ entry, list, data, lookNameRepeats, bodyDigest, state, setState, open, navigate }: {
  entry: BodyEntry;
  list: readonly BodyEntry[];
  data: CreatureData;
  lookNameRepeats: ReadonlySet<string>;
  bodyDigest: ReadonlyMap<string, ArtSummary>;
  state: string;
  setState: (state: string) => void;
  open: (assetId: string) => void;
  navigate: ViewProps["navigate"];
}) {
  const looks = entry.body.looks;
  const remembered = lastVariant.get(entry.assetId);
  const [variantId, setVariantId] = useState(() => looks.some(look => look.creatureId === remembered) ? remembered! : looks[0]!.creatureId);
  // Walking bodies reuses this component: follow the body to its remembered variant.
  const [shownBody, setShownBody] = useState(entry.assetId);
  const [previewMaps, setPreviewMaps] = useState<Record<string, string>>();
  if (shownBody !== entry.assetId) {
    setShownBody(entry.assetId);
    setVariantId(looks.some(look => look.creatureId === remembered) ? remembered! : looks[0]!.creatureId);
    setPreviewMaps(undefined);
  }
  // A just-created variant is selected before the refetched collection lists it; show the base meanwhile.
  const variant = looks.find(look => look.creatureId === variantId) ?? looks[0]!;
  const selectVariant = useCallback((id: string) => { lastVariant.set(entry.assetId, id); setVariantId(id); }, [entry.assetId]);

  const [panel, setPanelState] = useState<Panel>(lastPanel);
  const setPanel = (next: Panel) => { lastPanel = next; setPanelState(next); };
  const [skinsMode, setSkinsMode] = useState<SkinsMode>("list");
  const [adding, setAdding] = useState(false);
  const [crowd, setCrowd] = useState(1);
  const [seed, setSeed] = useState(0);

  const draft = useRecordDraft<Creature>("creatureDefinitions", variant.creatureId);
  const working = draft.draft ?? draft.record;
  const base = working?.baseId ? data.byId.get(working.baseId) : undefined;
  const presentation = presentationOf(working, base);
  const skins = useCreatureSkins(entry.assetId);
  const jobs = useImagegenJobs(entry.assetId);

  // The stage previews unsaved look edits, a crowd rolled from the variation range, and unsaved maps.
  const actorDraftKey = JSON.stringify({
    presentation: draft.dirty && presentation ? { scale: presentation.scale, skinId: presentation.skinId ?? null, variation: presentation.variation ?? null } : undefined,
    crowd: crowd > 1 ? crowd : undefined, seed: crowd > 1 && seed ? seed : undefined, maps: previewMaps,
  });
  const actorDraft = useMemo(() => {
    const value = JSON.parse(actorDraftKey) as ActorDraft;
    return Object.values(value).some(part => part !== undefined) ? value : undefined;
  }, [actorDraftKey]);

  const [readout, setReadout] = useState<StageReadout>(EMPTY_READOUT);
  const readoutKey = useRef("");
  const onSnapshot = useCallback((snapshot: ViewerSnapshot) => {
    // A model loading between variants reports no states; keep the last body's so the strip does not flicker.
    const next: StageReadout = { ready: snapshot.ready, states: snapshot.states, state: snapshot.state, size: snapshot.size, appearance: snapshot.appearance };
    const key = JSON.stringify(next);
    if (key === readoutKey.current) return;
    readoutKey.current = key;
    setReadout(previous => snapshot.ready || snapshot.states.length ? next : { ...previous, ready: false });
  }, []);

  const body = useArtReview("assets", entry.assetId);
  const variantReview = useArtReview("creatureDefinitions", variant.creatureId);
  const variantDigest = useArtDigest("creatureDefinitions").data;

  const stateItems: StateItem[] = useMemo(() => {
    const source = readout.states.length ? readout.states : CREATURE_STATES.map((name): ViewerStateInfo => ({ name, clip: null, available: false }));
    return source.map(info => ({ name: info.name, available: info.available, synthetic: info.synthetic, verdict: body.verdict(`state:${info.name}`) }));
  }, [readout.states, body]);
  const playable = stateItems.find(item => item.name === state && item.available);
  const activeState = playable ? state : readout.state ?? state;

  // J/K and Alt+Up/Down walk bodies; [ and ] walk this body's variants. Not while the add form is open.
  const latest = useRef({ list, entry, looks, variant, open, selectVariant, adding });
  latest.current = { list, entry, looks, variant, open, selectVariant, adding };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      const { list, entry, looks, variant, open, selectVariant, adding } = latest.current;
      if (adding) return;
      const stepBody = (by: 1 | -1) => { const index = list.indexOf(entry); const next = list[index + by]; if (next) open(next.assetId); };
      if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); stepBody(event.key === "ArrowDown" ? 1 : -1); return; }
      if (event.altKey || event.shiftKey || isEditable(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") { event.preventDefault(); stepBody(key === "j" ? 1 : -1); }
      if (event.key === "[" || event.key === "]") {
        const next = looks[looks.indexOf(variant) + (event.key === "]" ? 1 : -1)];
        if (next) { event.preventDefault(); selectVariant(next.creatureId); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Keep the selected variant in view as [ and ] walk the filmstrip (scrolling only the strip, never the page).
  const filmstrip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = filmstrip.current, scroller = strip?.parentElement, chip = strip?.querySelector<HTMLElement>("[aria-selected=true]");
    if (!scroller || !chip) return;
    const left = chip.offsetLeft - strip!.offsetLeft, right = left + chip.offsetWidth;
    if (left < scroller.scrollLeft) scroller.scrollLeft = left - 8;
    else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth + 8;
  }, [variant]);

  const newSkin = () => { setAdding(false); setPanel("skins"); setSkinsMode("generate"); };
  const wear = (skinId: string | undefined) => draft.set(current => withPresentation(current, base, { skinId }));
  const pool = presentation?.variation?.skins?.map(entry => entry.skinId) ?? [];
  const addToPool = (skinId: string) => draft.set(current => {
    const own = presentationOf(current, base)?.variation ?? {};
    return withPresentation(current, base, { variation: { ...own, skins: [...(own.skins ?? []), { skinId, weight: 1 }] } });
  });
  const prompt = useMemo(() => skinPrompt({ name: variant.name, family: variant.family, region: presentation?.regionId ? data.regionName(presentation.regionId) : undefined, description: presentation?.description }),
    [variant.name, variant.family, presentation?.regionId, presentation?.description, data]);
  const shownScale = presentation?.scale ?? variant.scale;

  const position = list.indexOf(entry);
  return <>
    <FocusLayout
      list={<BodyRail list={list} current={entry} digest={bodyDigest} position={position} open={open} />}
      header={<>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="max-w-[60%] shrink-0 truncate text-[15px] font-semibold text-foreground">{entry.name}</h1>
          <code className="truncate font-mono text-[11px] text-faint">{entry.assetId}</code>
          <span className="truncate text-[11px] text-muted-foreground">{[entry.body.families.map(titleCase).join(", "), `${looks.length} ${looks.length === 1 ? "variant" : "variants"}`].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="text-[11px] text-faint">Body</span>
        <VerdictBar value={body.verdict()} hotkeys={!adding} disabled={body.isPending} onChange={verdict => body.review({ verdict })} />
      </>}
      stage={<>
        <AssetViewer source={{ mode: "actor", creatureId: variant.creatureId, ...(actorDraft ? { draft: actorDraft } : {}) }} label={`${variant.name} model`} stage controls={false} state={activeState} onSnapshot={onSnapshot} />
        <CrowdControls crowd={crowd} setCrowd={setCrowd} reroll={() => setSeed(value => value + 1)} />
        <div className="pointer-events-none absolute bottom-2 left-3 flex flex-col text-[11px] text-muted-foreground [text-shadow:0_1px_2px_#000]">
          <span className="text-xs font-semibold text-foreground">{lookLabel(variant, lookNameRepeats)}</span>
          <span>{humanize(activeState)} · Level {working?.level ?? base?.level ?? variant.level} · ×{formatScale(shownScale)}{draft.dirty ? " · unsaved" : ""}{previewMaps ? " · recolor preview" : ""}</span>
        </div>
      </>}
      strip={<>
        <StripRow label="States"><StateStrip states={stateItems} value={activeState} onChange={setState} /></StripRow>
        <StripRow label="Variants">
          <Button variant="secondary" size="sm" className="h-auto min-h-11 shrink-0 self-stretch" disabled={!draft.editable} title="A new definition of this body: another level, region, size or skin" onClick={() => setAdding(true)}>+ Add variant</Button>
          <div className="min-w-0 flex-1 overflow-x-auto">
          <div ref={filmstrip} className="flex w-max shrink-0 items-stretch gap-1 pb-0.5" role="listbox" aria-label="Variants">
            {looks.map((look, index) => <VariantChip key={look.creatureId} look={look} index={index} selected={look === variant} regionName={data.regionName} label={look.name === entry.name ? look.creatureId : lookLabel(look, lookNameRepeats)} mono={look.name === entry.name}
              summary={variantDigest.get(look.creatureId)} onSelect={() => selectVariant(look.creatureId)} />)}
          </div>
          </div>
        </StripRow>
      </>}
      inspector={<div className="flex min-h-full flex-col text-xs">
        <div className="sticky top-0 z-[1] border-b border-border-subtle bg-background px-3 py-1.5">
          <Segmented aria-label="Inspector" className="w-full">
            {PANELS.map(option => <Button key={option.value} variant="segment" size="xs" className="flex-1" aria-pressed={panel === option.value} onClick={() => setPanel(option.value)}>
              {option.label}{option.value === "variant" && draft.dirty && <span className="size-1.5 rounded-full bg-warn" role="img" aria-label="unsaved" />}
            </Button>)}
          </Segmented>
        </div>
        {panel === "review" && <ReviewPanel entry={entry} variant={variant} state={activeState} readout={readout} body={body} variantReview={variantReview} data={data} lookNameRepeats={lookNameRepeats} />}
        {panel === "variant" && <VariantPanel draft={draft} data={data} skins={skins.skins} review={variantReview} navigate={navigate} onNewSkin={newSkin}
          onDeleted={() => selectVariant(variant.baseId ?? looks[0]!.creatureId)} />}
        {panel === "variation" && <VariationPanel draft={draft} data={data} skins={skins.skins} crowd={crowd} onCrowd={setCrowd} />}
        {panel === "skins" && <SkinsPanel key={entry.assetId} assetId={entry.assetId} bodyName={entry.name} leadId={entry.leadId} skins={skins.skins} skinsLoading={skins.loading} skinsError={skins.error}
          worn={presentation?.skinId} pool={pool} readOnly={!draft.editable} onWear={wear} onPool={addToPool} onPreviewMaps={setPreviewMaps} prompt={prompt}
          jobs={jobs.jobs} allJobs={jobs.allJobs} jobsUnavailable={jobs.unavailable} jobsError={jobs.error} refreshJobs={jobs.refresh} mode={skinsMode} setMode={setSkinsMode} />}
        <div className="mt-auto flex flex-col gap-1 border-t border-border-subtle px-3 py-2 text-[11px] text-faint">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Legend keys={["J", "K"]} label="body" /><Legend keys={["[", "]"]} label="variant" /><Legend keys={["1–9"]} label="state" /><Legend keys={["A", "P", "R"]} label="body verdict" />
          </div>
          <a className="text-link underline-offset-2 hover:underline" href={LAB_URL} target="_blank" rel="noreferrer">Open in lab (integration only)</a>
        </div>
      </div>}
    />
    {adding && <AddVariantDrawer entry={entry} selected={variant} data={data} skins={skins.skins} onClose={() => setAdding(false)} onNewSkin={newSkin}
      onCreated={id => { setAdding(false); selectVariant(id); setPanel("variant"); }} />}
  </>;
}

/** A herd on the stage, each individual rolled from the variation range the way the world rolls it. */
function CrowdControls({ crowd, setCrowd, reroll }: { crowd: number; setCrowd: (count: number) => void; reroll: () => void }) {
  return <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-background/80 p-0.5">
    <Button variant="segment" size="xs" className="h-6" aria-pressed={crowd > 1} title="Show several individuals rolled from the variation range" onClick={() => setCrowd(crowd > 1 ? 1 : 6)}>Crowd</Button>
    {crowd > 1 && <>
      <Segmented aria-label="Crowd size" className="h-6">
        {CROWD_SIZES.map(size => <Button key={size} variant="segment" size="xs" aria-pressed={crowd === size} onClick={() => setCrowd(size)}>{size}</Button>)}
      </Segmented>
      <Button variant="segment" size="xs" className="h-6" title="Roll another sample of the same range" onClick={reroll}>Reroll</Button>
    </>}
  </div>;
}

function BodyRail({ list, current, digest, position, open }: { list: readonly BodyEntry[]; current: BodyEntry; digest: ReadonlyMap<string, ArtSummary>; position: number; open: (assetId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current, row = box?.querySelector<HTMLElement>("[aria-current='true']");
    if (!box || !row) return;
    const outer = box.getBoundingClientRect(), inner = row.getBoundingClientRect();
    if (inner.top < outer.top || inner.bottom > outer.bottom) box.scrollTop += inner.top - outer.top - outer.height / 2 + inner.height / 2;
  }, [current]);
  return <>
    <div className="flex min-h-11 items-center gap-2 border-b border-border-subtle px-3">
      <span className="text-xs font-semibold text-foreground">Bodies</span>
      <span className="ml-auto font-mono text-[11px] text-faint tabular-nums">{position + 1} of {list.length}</span>
    </div>
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto p-1" role="list">
      {list.map(entry => <button key={entry.assetId} type="button" role="listitem" aria-current={entry === current ? "true" : undefined} title={`${entry.name} · ${entry.assetId}`}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md py-0.5 pr-2 pl-1 text-left text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 aria-[current=true]:bg-selected aria-[current=true]:text-foreground"
        onClick={() => open(entry.assetId)}>
        <CreatureArt creatureId={entry.leadId} className="size-8 shrink-0 rounded-sm" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs leading-tight">{entry.name}</span>
          <span className="truncate text-[11px] leading-tight text-faint">{entry.nameRepeats ? entry.assetId : `L${entry.level} · ${entry.body.looks.length} ${entry.body.looks.length === 1 ? "variant" : "variants"}`}</span>
        </span>
        <BodyVerdict summary={digest.get(entry.assetId)} />
      </button>)}
    </div>
  </>;
}

function VariantChip({ look, index, selected, label, mono, regionName, summary, onSelect }: {
  look: CreatureLook; index: number; selected: boolean; label: string; mono: boolean; regionName: (id: string | undefined) => string; summary: ArtSummary | undefined; onSelect: () => void;
}) {
  const skinned = look.presentation && "skinId" in look.presentation && look.presentation.skinId;
  const varied = look.presentation && "variation" in look.presentation && look.presentation.variation;
  return <button type="button" role="option" aria-selected={selected} data-creature-id={look.creatureId} title={`${look.creatureId}${look.inherited ? ` · wears ${look.baseId}'s presentation` : ""}`}
    className="flex max-w-60 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border-subtle bg-card py-1 pr-2 pl-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:border-transparent aria-selected:bg-selected"
    onClick={onSelect}>
    <CreatureArt creatureId={look.creatureId} className="size-9 shrink-0 rounded-sm" />
    <span className="flex min-w-0 flex-col gap-px">
    <span className="flex min-w-0 items-center gap-1.5">
      {summary?.verdict ? <VerdictDot verdict={summary.verdict} /> : <Unreviewed />}
      <span className={cn("truncate text-xs leading-tight", mono && "font-mono text-[11px]", selected ? "font-semibold text-foreground" : "text-muted-foreground")}>{label}</span>
    </span>
    <span className="truncate text-[11px] leading-tight text-faint tabular-nums">
      {index + 1}. L{look.level} · {look.regionId ? regionName(look.regionId) : "No region"} · ×{formatScale(look.scale)}{skinned ? " · skin" : ""}{varied ? " · varied" : ""}{look.inherited ? " · inherited" : ""}
    </span>
    </span>
  </button>;
}

type Review = ReturnType<typeof useArtReview>;

function ReviewPanel({ entry, variant, state, readout, body, variantReview, data, lookNameRepeats }: {
  entry: BodyEntry; variant: CreatureLook; state: string; readout: StageReadout; body: Review; variantReview: Review; data: CreatureData; lookNameRepeats: ReadonlySet<string>;
}) {
  const stateKey = `state:${state}`;
  const manifest = useMemo(() => {
    const rows = data.index.collections.get("assets")?.data;
    return Array.isArray(rows) ? rows.find(row => (row as { id?: string }).id === entry.assetId) as ManifestRow | undefined : undefined;
  }, [data.index, entry.assetId]);
  const source = variant.presentation?.source;
  const provenance = manifest?.sourceProvenance;
  const size = readout.size;
  const tint = readout.appearance?.creatureId === variant.creatureId ? readout.appearance.tint : undefined;
  return <>
    <Section title={`State · ${humanize(state)}`}>
      <VerdictBar size="xs" value={body.verdict(stateKey)} disabled={body.isPending} onChange={verdict => body.review({ key: stateKey, verdict })} />
      <Textarea key={`${entry.assetId}:${stateKey}:${body.isPending}`} aria-label={`Note on ${humanize(state)}`} rows={2} className="text-xs" placeholder={`Note on ${humanize(state).toLowerCase()}…`}
        defaultValue={body.note(stateKey) ?? ""} disabled={body.isPending}
        onBlur={event => { if (event.target.value !== (body.note(stateKey) ?? "")) body.review({ key: stateKey, note: event.target.value }); }} />
    </Section>
    <Section title="Variant">
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-foreground">{lookLabel(variant, lookNameRepeats)}</span>
        <code className="truncate font-mono text-[11px] text-faint">{variant.creatureId}</code>
      </div>
      <Pairs rows={[
        ["Level", String(variant.level)],
        ["Region", variant.regionId ? data.regionName(variant.regionId) : "None"],
        ["Scale", `×${formatScale(variant.scale)}`],
        ["Look", variant.inherited ? `Inherited from ${variant.baseId}` : variant.baseId ? `Own, variant of ${variant.baseId}` : "Own"],
      ]} />
      <VerdictBar size="xs" value={variantReview.verdict()} disabled={variantReview.isPending} onChange={verdict => variantReview.review({ verdict })} />
    </Section>
    <Section title="Appearance">
      <Pairs rows={[
        ["Tint", tint ? <span className="inline-flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm border border-border" style={{ background: tint }} /><code className="font-mono">{tint}</code></span> : readout.ready ? "None" : "…"],
        ["Size", size ? `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m` : "…"],
        ["Clips", readout.ready ? `${readout.states.filter(info => info.available).length} of ${readout.states.length} states` : "…"],
      ]} />
    </Section>
    <Section title="Provenance">
      <Pairs rows={[
        ["Pack", manifest?.pack ?? "Unknown"],
        ["License", source?.license ?? provenance?.upstreamLicense ?? "Not recorded"],
        ["Generator", source?.generator ?? provenance?.generator?.split("/").at(-1) ?? "None"],
        ...(source?.author ? [["Author", source.author] as [string, string]] : []),
      ]} />
    </Section>
  </>;
}

interface ManifestRow { id: string; pack?: string; sourceProvenance?: { upstreamLicense?: string; generator?: string } }
