import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { collectionQuery } from "../../../api/client.js";
import { Badge, Button, Checkbox, Input, NativeSelect, Segmented, Textarea } from "../../../components/ui/index.js";
import { cn } from "../../../lib/utils.js";
import { canReviewArt, useArtDigest, useArtReview } from "../../../model/artReview.js";
import { VerdictBar, VerdictDot } from "../../../ui/FocusLayout.js";
import { CreatureArt } from "./CreatureArt.js";
import { Blocked, Note, Row, Rows, Section, errorText } from "./parts.js";
import { filesBlock, imagegenBlock, metaBlock } from "../gates.js";
import { SkinFilesDrawer } from "./SkinFilesDrawer.js";
import { UploadView } from "./UploadView.js";
import { IDENTITY_RECOLOR, isIdentityRecolor, type RecolorParams } from "./recolor.js";
import {
  SkinApiUnavailable, bakeRecolor, decodeMaps, isActiveJob, loadAlbedo, mapsToBase64, retryImagegen, saveSkin, skinMapUrl, startImagegen,
  type CreatureSkin, type DecodedMap, type ImagegenJob,
} from "./skinApi.js";

export type SkinsMode = "list" | "upload" | "recolor" | "generate";

const KIND: Readonly<Record<CreatureSkin["kind"], { label: string; tone: "ok" | "warn" | "default" }>> = {
  imagegen: { label: "Generated", tone: "ok" },
  recolor: { label: "Recolor", tone: "warn" },
  upload: { label: "Uploaded", tone: "default" },
  source: { label: "Source", tone: "default" },
};

export interface SkinsPanelProps {
  assetId: string;
  bodyName: string;
  /** The body's lead definition, for the model's own thumbnail. */
  leadId: string;
  /** The selected definition that Wear and + Pool change, e.g. "Stag · deer_t5 (variant)". */
  target: string;
  skins: readonly CreatureSkin[];
  skinsLoading: boolean;
  skinsError?: string;
  /** The skin the selected definition wears (draft), and its variation pool. */
  worn: string | undefined;
  pool: readonly string[];
  readOnly: boolean;
  onWear: (skinId: string | undefined) => void;
  onPool: (skinId: string) => void;
  /** Unsaved maps shown on the stage (object URLs), or undefined to show the saved look. */
  onPreviewMaps: (maps: Record<string, string> | undefined) => void;
  prompt: string;
  jobs: readonly ImagegenJob[];
  /** Every model's jobs, for a failed job on a model with no body page. */
  allJobs: readonly ImagegenJob[];
  jobsUnavailable: boolean;
  jobsError?: string;
  refreshJobs: () => void;
  mode: SkinsMode;
  setMode: (mode: SkinsMode) => void;
}

export function SkinsPanel(props: SkinsPanelProps) {
  const { mode, setMode, skins, jobs } = props;
  const active = jobs.filter(isActiveJob).length;
  // The raw file view: a skin id, "" for the model's own maps, or closed.
  const [files, setFiles] = useState<string>();
  const filesSkin = files ? skins.find(skin => skin.id === files) : undefined;
  return <>
    <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5">
      <Segmented aria-label="Skins view" className="w-full">
        {([["list", `Skins ${skins.length}`], ["upload", "Upload"], ["recolor", "Recolor"], ["generate", active ? `Generate · ${active}` : "Generate"]] as const).map(([value, label]) =>
          <Button key={value} variant="segment" size="xs" className="flex-1" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</Button>)}
      </Segmented>
    </div>
    <p className="truncate border-b border-border-subtle px-3 py-1 text-[11px] text-faint" data-wear-target="" title={`Wear and + Pool change ${props.target}`}>
      Wear applies to: <span className="font-semibold text-foreground">{props.target}</span>
    </p>
    {mode === "list" && <SkinList {...props} onOpenFiles={setFiles} />}
    {mode === "upload" && <UploadView assetId={props.assetId} bodyName={props.bodyName} skins={skins} readOnly={props.readOnly} target={props.target} worn={props.worn} pool={props.pool}
      onWear={props.onWear} onPool={props.onPool} onPreviewMaps={props.onPreviewMaps} onOpenFiles={skinId => { setMode("list"); setFiles(skinId); }} />}
    {files !== undefined && (files === "" || filesSkin) && <SkinFilesDrawer key={files} assetId={props.assetId} modelName={props.bodyName} skin={filesSkin} readOnly={props.readOnly}
      onClose={() => setFiles(undefined)} onPreviewMaps={props.onPreviewMaps} />}
    {mode === "recolor" && <RecolorView {...props} />}
    {mode === "generate" && <GenerateView {...props} />}
  </>;
}

/* ---------- List ---------- */

function SkinList({ skins, skinsLoading, skinsError, worn, pool, readOnly, onWear, onPool, leadId, jobs, setMode, onOpenFiles }: SkinsPanelProps & { onOpenFiles: (skinId: string) => void }) {
  const active = jobs.filter(isActiveJob);
  const blocked = filesBlock();
  return <Section title="This model's skins" aside={<Button variant="secondary" size="xs" disabled={readOnly || Boolean(blocked)} title={blocked ?? "Upload hand-made maps as a new skin"} onClick={() => setMode("upload")}>Upload skin</Button>}>
    {skinsError && <Note tone="error">{skinsError}</Note>}
    {active.length > 0 && <Note tone="warn">{active.length} generating: <Button variant="link" size="inline" onClick={() => setMode("generate")}>see jobs</Button></Note>}
    <div className="grid grid-cols-2 gap-1.5">
      <SkinTile title="Model's own maps" subtitle="From the pack" art={<CreatureArt creatureId={leadId} className="size-full" />}
        worn={!worn} readOnly={readOnly} onWear={() => onWear(undefined)} onOpen={() => onOpenFiles("")} />
      {skins.map(skin => {
        const [material, map] = Object.entries(skin.maps)[0] ?? [];
        // A merge rewrites the same path; the file's hash keeps the browser from showing the old one.
        const hash = material ? skin.sha256?.[material]?.slice(0, 12) : undefined;
        const kind = KIND[skin.kind];
        return <SkinTile key={skin.id} title={skin.name} subtitle={skin.id} skinId={skin.id}
          art={map ? <img src={`${skinMapUrl(map)}${hash ? `?v=${hash}` : ""}`} alt="" loading="lazy" className="size-full object-cover" /> : null}
          badge={<Badge variant={kind.tone} className="h-4 px-1 text-[10px]">{kind.label}</Badge>}
          worn={worn === skin.id} pooled={pool.includes(skin.id)} readOnly={readOnly}
          onWear={() => onWear(skin.id)} onPool={() => onPool(skin.id)} onOpen={() => onOpenFiles(skin.id)} />;
      })}
    </div>
    {!skinsLoading && !skins.length && <Note>No skins for this model yet. Generate a regional look, upload hand-painted maps, or bake a recolor to mix into a variation pool.</Note>}
    <Note>Click a tile to see its raw map files.</Note>
    <Blocked reason={blocked} />
    {worn && <WornSkinVerdict skinId={worn} readOnly={readOnly} />}
  </Section>;
}

function SkinVerdictDot({ skinId }: { skinId: string }) {
  const verdict = useArtDigest("creatureSkins").data.get(skinId)?.verdict;
  return verdict ? <span className="absolute top-1.5 right-1.5"><VerdictDot verdict={verdict} /></span> : null;
}

/** The verdict on the skin the selected definition wears; tiles show every skin's verdict as a dot. */
function WornSkinVerdict({ skinId, readOnly }: { skinId: string; readOnly: boolean }) {
  const review = useArtReview("creatureSkins", skinId);
  const blocked = metaBlock();
  return <div className="flex flex-col gap-1 pt-1">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-faint">Worn skin</span>
      <VerdictBar size="xs" value={review.verdict()} disabled={readOnly || !canReviewArt()} onChange={verdict => review.review({ verdict })} />
    </div>
    <Blocked reason={blocked} />
  </div>;
}

function SkinTile({ title, subtitle, skinId, art, badge, worn, pooled, readOnly, onWear, onPool, onOpen }: {
  title: string; subtitle: string; skinId?: string; art: React.ReactNode; badge?: React.ReactNode; worn: boolean; pooled?: boolean; readOnly: boolean; onWear: () => void; onPool?: () => void; onOpen: () => void;
}) {
  return <div className={cn("flex min-w-0 flex-col gap-1 rounded-md border border-border-subtle bg-card p-1", worn && "border-transparent bg-selected")} data-skin-id={skinId ?? ""}>
    <button type="button" className="flex min-w-0 cursor-pointer flex-col gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40" title={`${title}: see its map files`} aria-label={`${title} files`} onClick={onOpen}>
      <span className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-sm bg-art">
        {art}
        {badge && <span className="absolute top-1 left-1">{badge}</span>}
        {skinId && <SkinVerdictDot skinId={skinId} />}
      </span>
      <span className="flex min-w-0 flex-col px-0.5">
        <span className="truncate text-xs leading-tight font-semibold text-foreground">{title}</span>
        <code className="truncate font-mono text-[10px] text-faint">{subtitle}</code>
      </span>
    </button>
    <span className="flex items-center gap-1">
      <Button variant="secondary" size="xs" className="flex-1" aria-pressed={worn} disabled={readOnly || worn} onClick={onWear}>{worn ? "Worn" : "Wear"}</Button>
      {onPool && <Button variant="secondary" size="xs" className="flex-1" disabled={readOnly || pooled} onClick={onPool}>{pooled ? "In pool" : "+ Pool"}</Button>}
    </span>
  </div>;
}

/* ---------- Recolor ---------- */

interface Baked { material: string; png: Blob }

function RecolorView({ assetId, bodyName, skins, onPreviewMaps, setMode }: SkinsPanelProps) {
  const queryClient = useQueryClient();
  const [source, setSource] = useState("");
  const [params, setParams] = useState<RecolorParams>(IDENTITY_RECOLOR);
  const [masked, setMasked] = useState(false);
  const [near, setNear] = useState({ hue: 30, width: 45 });
  const [name, setName] = useState(() => `${bodyName} recolor ${skins.filter(skin => skin.kind === "recolor").length + 1}`);
  const [decoded, setDecoded] = useState<DecodedMap[]>();
  const [loadError, setLoadError] = useState("");
  const [baking, setBaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const baked = useRef<Baked[] | undefined>(undefined);
  const urls = useRef<string[]>([]);
  const effective: RecolorParams = masked ? { ...params, near } : params;
  const blocked = filesBlock();

  const release = () => { for (const url of urls.current) URL.revokeObjectURL(url); urls.current = []; };
  // Leaving the recolor view puts the saved look back on the stage.
  useEffect(() => () => { release(); onPreviewMaps(undefined); }, [onPreviewMaps]);

  useEffect(() => {
    let live = true;
    setDecoded(undefined); setLoadError("");
    loadAlbedo(assetId, source || undefined).then(decodeMaps).then(maps => { if (live) setDecoded(maps); }, error => { if (live) setLoadError(errorText(error)); });
    return () => { live = false; };
  }, [assetId, source]);

  const key = JSON.stringify(effective);
  useEffect(() => {
    if (!decoded) return;
    if (isIdentityRecolor(effective)) { baked.current = undefined; release(); onPreviewMaps(undefined); return; }
    let live = true;
    const timer = setTimeout(() => {
      setBaking(true);
      bakeRecolor(decoded, effective).then(result => {
        if (!live) return;
        baked.current = result;
        release();
        const next: Record<string, string> = {};
        for (const map of result) { const url = URL.createObjectURL(map.png); urls.current.push(url); next[map.material] = url; }
        onPreviewMaps(next);
      }, error => { if (live) setLoadError(errorText(error)); }).finally(() => { if (live) setBaking(false); });
    }, 180);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, key, onPreviewMaps]);

  async function save() {
    if (!baked.current || !name.trim() || blocked) return;
    setSaving(true); setSaveError("");
    try {
      const response = await saveSkin({
        assetId, name: name.trim(), kind: "recolor", maps: await mapsToBase64(baked.current),
        recolor: { ...(source ? { fromSkinId: source } : {}), hue: params.hue, saturation: params.saturation, value: params.value, ...(masked ? { near } : {}) },
      });
      await queryClient.invalidateQueries({ queryKey: collectionQuery("creatureSkins").queryKey });
      toast.success(`Saved skin ${response.skin.id}`);
      setMode("list");
    } catch (error) {
      setSaveError(error instanceof SkinApiUnavailable ? `${error.message} The recolor still previews on the stage.` : errorText(error));
    } finally { setSaving(false); }
  }

  const set = (patch: Partial<RecolorParams>) => setParams(current => ({ ...current, ...patch }));
  return <Section title="Recolor">
    <Note tone="warn">Recolors are for variation pools. A new regional look should be generated, never a flat recolor.</Note>
    <Rows>
      <Row label="From">
        <NativeSelect className="h-7 text-xs" wrapperClassName="min-w-0 flex-1" aria-label="Recolor from" value={source} onChange={event => setSource(event.target.value)}>
          <option value="">Model's own maps</option>
          {skins.map(skin => <option key={skin.id} value={skin.id}>{skin.name} ({skin.kind})</option>)}
        </NativeSelect>
      </Row>
      <Slider label="Hue" value={params.hue} min={-180} max={180} step={1} format={value => `${value > 0 ? "+" : ""}${value}°`} onChange={hue => set({ hue })} />
      <Slider label="Saturation" value={params.saturation} min={0} max={2} step={0.01} format={value => `×${value.toFixed(2)}`} onChange={saturation => set({ saturation })} />
      <Slider label="Brightness" value={params.value} min={0} max={2} step={0.01} format={value => `×${value.toFixed(2)}`} onChange={value => set({ value })} />
      <Row label="Only near">
        <Checkbox aria-label="Only shift hues near one colour" checked={masked} onCheckedChange={checked => setMasked(checked === true)} />
        <span className={cn("size-4 shrink-0 rounded-sm border border-border", !masked && "opacity-40")} style={{ background: `hsl(${near.hue} 70% 50%)` }} />
        <span className={cn("truncate text-[11px]", masked ? "text-muted-foreground" : "text-faint")}>hue {near.hue}° ± {near.width}°</span>
      </Row>
      {masked && <>
        <Slider label="Colour" value={near.hue} min={0} max={359} step={1} format={value => `${value}°`} onChange={hue => setNear(current => ({ ...current, hue }))} />
        <Slider label="Width" value={near.width} min={5} max={180} step={1} format={value => `±${value}°`} onChange={width => setNear(current => ({ ...current, width }))} />
      </>}
      <Row label="Name"><Input aria-label="Skin name" value={name} onChange={event => setName(event.target.value)} /></Row>
    </Rows>
    {loadError && <Note tone="error">{loadError}</Note>}
    {!loadError && <Note>{!decoded ? "Loading maps…" : `${decoded.length} ${decoded.length === 1 ? "map" : "maps"}: ${decoded.map(map => `${map.material} ${map.image.width}²`).join(", ")}${baking ? " · baking…" : isIdentityRecolor(effective) ? " · move a slider to preview" : " · previewing on the stage"}`}</Note>}
    {masked && <Note>The saved record keeps hue, saturation and brightness; the colour mask lives only in the baked maps.</Note>}
    {saveError && <Note tone="error">{saveError}</Note>}
    <Blocked reason={blocked} />
    <div className="flex items-center justify-end gap-2">
      <Button variant="ghost" size="xs" disabled={isIdentityRecolor(params) && !masked} onClick={() => { setParams(IDENTITY_RECOLOR); setMasked(false); }}>Reset</Button>
      <Button variant="default" size="xs" disabled={!baked.current || baking || saving || !name.trim() || Boolean(blocked)} title={blocked} onClick={() => void save()}>{saving ? "Saving…" : "Save as skin"}</Button>
    </div>
  </Section>;
}

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void }) {
  return <Row label={label}>
    <input type="range" aria-label={label} className="h-4 min-w-0 flex-1 cursor-pointer accent-primary" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} />
    <span className="w-11 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{format(value)}</span>
  </Row>;
}

/* ---------- Generate ---------- */

function GenerateView({ assetId, bodyName, worn, prompt: initialPrompt, jobs, allJobs, jobsUnavailable, jobsError, refreshJobs, skins, onWear, readOnly }: SkinsPanelProps) {
  const [name, setName] = useState(() => `${bodyName} generated ${skins.filter(skin => skin.kind === "imagegen").length + 1}`);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [everyModel, setEveryModel] = useState(false);
  const shownJobs = everyModel ? allJobs : jobs;
  const wornName = worn ? skins.find(skin => skin.id === worn)?.name ?? worn : "the model's own maps";
  const blocked = imagegenBlock();

  async function generate() {
    setBusy(true); setError("");
    try {
      const references = await mapsToBase64(await loadAlbedo(assetId, worn));
      await startImagegen({ assetId, name: name.trim(), prompt: prompt.trim(), references });
      refreshJobs();
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }

  return <>
    <Section title="Generate a look">
      <Note>Image generation repaints the current maps from the prompt and saves an imagegen skin for review. This is the way to a finished regional look.</Note>
      <Rows>
        <Row label="Name"><Input aria-label="Generated skin name" value={name} onChange={event => setName(event.target.value)} /></Row>
        <Row label="References"><span className="truncate text-[11px] text-muted-foreground">maps of {wornName}</span></Row>
      </Rows>
      <Textarea aria-label="Prompt" rows={7} className="text-xs" value={prompt} onChange={event => setPrompt(event.target.value)} />
      {error && <Note tone="error">{error}</Note>}
      <Blocked reason={blocked} />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="xs" disabled={prompt === initialPrompt} onClick={() => setPrompt(initialPrompt)}>Reset prompt</Button>
        <Button variant="default" size="xs" disabled={busy || readOnly || Boolean(blocked) || !prompt.trim() || !name.trim()} title={blocked} onClick={() => void generate()}>{busy ? "Sending…" : "Generate"}</Button>
      </div>
    </Section>
    <Section title="Jobs" aside={<>
      <Segmented aria-label="Jobs of" className="h-6">
        <Button variant="segment" size="xs" aria-pressed={!everyModel} onClick={() => setEveryModel(false)}>This model</Button>
        <Button variant="segment" size="xs" aria-pressed={everyModel} onClick={() => setEveryModel(true)}>All {allJobs.length}</Button>
      </Segmented>
      <Button variant="ghost" size="xs" disabled={jobsUnavailable} onClick={refreshJobs}>Refresh</Button>
    </>}>
      {jobsUnavailable && <Note>{blocked ?? "Image generation is not available here."} No jobs to show.</Note>}
      {jobsError && <Note tone="error">{jobsError}</Note>}
      {!jobsUnavailable && !shownJobs.length && <Note>{everyModel ? "No jobs yet." : "No jobs for this model."}</Note>}
      {shownJobs.length > 0 && <JobList jobs={shownJobs} assetId={assetId} worn={worn} readOnly={readOnly} retryBlocked={blocked} onWear={onWear} onRetried={refreshJobs} />}
    </Section>
  </>;
}

const STATUS_TONE: Readonly<Record<ImagegenJob["status"], "default" | "info" | "ok" | "danger">> = { queued: "default", running: "info", done: "ok", failed: "danger" };

function JobList({ jobs, assetId, worn, readOnly, retryBlocked, onWear, onRetried }: { jobs: readonly ImagegenJob[]; assetId: string; worn: string | undefined; readOnly: boolean; retryBlocked: string | undefined; onWear: (skinId: string) => void; onRetried: () => void }) {
  const [retrying, setRetrying] = useState<string>();
  const [retryError, setRetryError] = useState("");
  const retry = async (job: ImagegenJob) => {
    setRetrying(job.id); setRetryError("");
    try { await retryImagegen(job.id); onRetried(); } catch (error) { setRetryError(errorText(error)); } finally { setRetrying(undefined); }
  };
  const [now, setNow] = useState(() => Date.now());
  const ticking = jobs.some(isActiveJob);
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return <>{retryError && <Note tone="error">{retryError}</Note>}<div role="table" aria-label="Image generation jobs" className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-0.5 text-xs">
    <div role="row" className="col-span-full grid h-6 grid-cols-subgrid items-center border-b border-border-subtle text-[11px] text-muted-foreground">
      <span role="columnheader">Status</span><span role="columnheader">Skin</span><span role="columnheader" className="text-right">Time</span><span role="columnheader" className="sr-only">Action</span>
    </div>
    {jobs.map(job => <div key={job.id} role="row" className="col-span-full grid min-h-7 grid-cols-subgrid items-center border-b border-border-subtle/60 py-0.5" data-job-status={job.status}>
      <span role="cell"><Badge variant={STATUS_TONE[job.status]} className="h-4 px-1 text-[10px]">{job.status}</Badge></span>
      <span role="cell" className="flex min-w-0 flex-col">
        <span className="truncate" title={job.prompt}>{job.name}</span>
        {job.assetId !== assetId && <code className="truncate font-mono text-[10px] text-faint">{job.assetId}</code>}
        {job.status === "failed" && <span className="truncate text-[11px] text-destructive" title={job.log ?? job.error}>{job.error ?? "Failed"}</span>}
      </span>
      <span role="cell" className="text-right font-mono text-[11px] text-faint tabular-nums">{elapsed(job, now)}</span>
      <span role="cell">{job.status === "done" && job.skinId && job.assetId === assetId
        ? <Button variant="secondary" size="xs" aria-pressed={worn === job.skinId} disabled={readOnly || worn === job.skinId} onClick={() => onWear(job.skinId!)}>{worn === job.skinId ? "Worn" : "Wear"}</Button>
        : job.status === "failed"
          ? <Button variant="secondary" size="xs" disabled={readOnly || Boolean(retryBlocked) || retrying === job.id} title={retryBlocked ?? "Run the job again, reusing any maps it already painted"} onClick={() => void retry(job)}>{retrying === job.id ? "Retrying…" : "Retry"}</Button>
          : null}</span>
    </div>)}
  </div></>;
}

function elapsed(job: ImagegenJob, now: number): string {
  const start = Date.parse(job.startedAt ?? job.createdAt);
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
