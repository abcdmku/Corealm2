import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Kbd, Textarea } from "../../../components/ui/index.js";
import { cn } from "../../../lib/utils.js";
import { useArtDigest, useArtReview, type ArtSummary } from "../../../model/artReview.js";
import type { CreatureLook } from "../../../model/creatureArt.js";
import { FocusLayout, StateStrip, StripRow, VerdictBar, VerdictDot, humanize, type StateItem } from "../../../ui/FocusLayout.js";
import { CreatureArt } from "./CreatureArt.js";
import { AssetViewer } from "../../../viewer/AssetViewer.js";
import { CREATURE_STATES, type ViewerAppearance, type ViewerSize, type ViewerSnapshot, type ViewerStateInfo } from "../../../viewer/types.js";
import type { ViewProps } from "../../types.js";
import { titleCase, type CreatureData } from "../../creatures/shared.js";
import { BodyVerdict, Unreviewed } from "./BodyIndex.js";
import { lookLabel, type BodyEntry } from "./model.js";

/** The variant last looked at on each body, so coming back to a body lands on the same one. */
const lastVariant = new Map<string, string>();
export const rememberVariant = (assetId: string, creatureId: string) => { lastVariant.set(assetId, creatureId); };

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
  if (shownBody !== entry.assetId) {
    setShownBody(entry.assetId);
    setVariantId(looks.some(look => look.creatureId === remembered) ? remembered! : looks[0]!.creatureId);
  }
  const variant = looks.find(look => look.creatureId === variantId) ?? looks[0]!;
  const selectVariant = useCallback((id: string) => { lastVariant.set(entry.assetId, id); setVariantId(id); }, [entry.assetId]);

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

  // J/K and Alt+Up/Down walk bodies; [ and ] walk this body's variants.
  const latest = useRef({ list, entry, looks, variant, open, selectVariant });
  latest.current = { list, entry, looks, variant, open, selectVariant };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      const { list, entry, looks, variant, open, selectVariant } = latest.current;
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

  const position = list.indexOf(entry);
  return <FocusLayout
    list={<BodyRail list={list} current={entry} digest={bodyDigest} position={position} open={open} />}
    header={<>
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1 className="max-w-[60%] shrink-0 truncate text-[15px] font-semibold text-foreground">{entry.name}</h1>
        <code className="truncate font-mono text-[11px] text-faint">{entry.assetId}</code>
        <span className="truncate text-[11px] text-muted-foreground">{[entry.body.families.map(titleCase).join(", "), `${looks.length} ${looks.length === 1 ? "variant" : "variants"}`].filter(Boolean).join(" · ")}</span>
      </div>
      <span className="text-[11px] text-faint">Body</span>
      <VerdictBar value={body.verdict()} hotkeys disabled={body.isPending} onChange={verdict => body.review({ verdict })} />
    </>}
    stage={<>
      <AssetViewer source={{ mode: "actor", creatureId: variant.creatureId }} label={`${variant.name} model`} stage controls={false} state={activeState} onSnapshot={onSnapshot} />
      <div className="pointer-events-none absolute bottom-2 left-3 flex flex-col text-[11px] text-muted-foreground [text-shadow:0_1px_2px_#000]">
        <span className="text-xs font-semibold text-foreground">{lookLabel(variant, lookNameRepeats)}</span>
        <span>{humanize(activeState)} · Level {variant.level} · ×{formatScale(variant.scale)}</span>
      </div>
    </>}
    strip={<>
      <StripRow label="States"><StateStrip states={stateItems} value={activeState} onChange={setState} /></StripRow>
      <StripRow label="Variants">
        <div ref={filmstrip} className="flex w-max shrink-0 items-stretch gap-1 pb-0.5" role="listbox" aria-label="Variants">
          {looks.map((look, index) => <VariantChip key={look.creatureId} look={look} index={index} selected={look === variant} regionName={data.regionName} label={look.name === entry.name ? look.creatureId : lookLabel(look, lookNameRepeats)} mono={look.name === entry.name}
            summary={variantDigest.get(look.creatureId)} onSelect={() => selectVariant(look.creatureId)} />)}
        </div>
      </StripRow>
    </>}
    inspector={<Inspector entry={entry} variant={variant} state={activeState} readout={readout} body={body} variantReview={variantReview} data={data} lookNameRepeats={lookNameRepeats} navigate={navigate} />}
  />;
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
      {index + 1}. L{look.level} · {look.regionId ? regionName(look.regionId) : "No region"} · ×{formatScale(look.scale)}{look.inherited ? " · inherited" : ""}
    </span>
    </span>
  </button>;
}

type Review = ReturnType<typeof useArtReview>;

function Inspector({ entry, variant, state, readout, body, variantReview, data, lookNameRepeats, navigate }: {
  entry: BodyEntry; variant: CreatureLook; state: string; readout: StageReadout; body: Review; variantReview: Review; data: CreatureData; lookNameRepeats: ReadonlySet<string>; navigate: ViewProps["navigate"];
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
  return <div className="flex min-h-full flex-col text-xs">
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
      <div className="flex items-center gap-2">
        <VerdictBar size="xs" value={variantReview.verdict()} disabled={variantReview.isPending} onChange={verdict => variantReview.review({ verdict })} />
        <Button variant="link" size="xs" className="ml-auto" onClick={() => navigate("creatures/bestiary", variant.creatureId)}>Edit stats</Button>
      </div>
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
    <div className="mt-auto flex flex-col gap-1 border-t border-border-subtle px-3 py-2 text-[11px] text-faint">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Legend keys={["J", "K"]} label="body" /><Legend keys={["[", "]"]} label="variant" /><Legend keys={["1–9"]} label="state" /><Legend keys={["A", "P", "R"]} label="body verdict" />
      </div>
      <a className="text-link underline-offset-2 hover:underline" href={LAB_URL} target="_blank" rel="noreferrer">Open in lab (integration only)</a>
    </div>
  </div>;
}

interface ManifestRow { id: string; pack?: string; sourceProvenance?: { upstreamLicense?: string; generator?: string } }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-1.5 border-b border-border-subtle px-3 py-2">
    <h2 className="text-[11px] font-semibold tracking-[.04em] text-faint uppercase">{title}</h2>
    {children}
  </section>;
}

function Pairs({ rows }: { rows: readonly (readonly [string, React.ReactNode])[] }) {
  return <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px]">
    {rows.map(([label, value]) => <div key={label} className="contents"><dt className="text-faint">{label}</dt><dd className="truncate text-muted-foreground" title={typeof value === "string" ? value : undefined}>{value}</dd></div>)}
  </dl>;
}

function Legend({ keys, label }: { keys: readonly string[]; label: string }) {
  return <span className="inline-flex items-center gap-0.5">{keys.map(key => <Kbd key={key}>{key}</Kbd>)}<span className="ml-0.5">{label}</span></span>;
}

const formatScale = (scale: number) => Number(scale.toFixed(2)).toString();
