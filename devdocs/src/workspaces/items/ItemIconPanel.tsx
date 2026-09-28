import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImageOff } from "lucide-react";
import { Badge, Button, Checkbox, Textarea } from "../../components/ui/index.js";
import { Row, Section, Static } from "../../ui/field/index.js";
import { cn } from "../../lib/utils.js";
import { ITEM_ICON_GAME_SIZE, ITEM_ICON_MASTER_SIZE } from "../../../../game/src/content/itemIconArt.js";
import {
  deriveUpload, iconArtworkId, iconBlock, iconUrls, itemIconPrompt, repoIcons, reviewIcon, startIconJob, storeUpload, useIconState,
  type IconFacts, type IconUpload,
} from "./iconApi.js";

/*
  An item's inventory art (docs/item-icons.md): the 256 master and the 48 icon at their real sizes,
  where they came from, and the three ways to change them. Generate paints a new original from a
  prompt; Upload takes a generated original and shows both derived sizes before storing them; Review
  approves or rejects what is stored. A stored icon is what players get; it stays a candidate until
  approved.
*/

const STATUS_TONE: Readonly<Record<string, "ok" | "warn" | "danger" | "default">> = { approved: "ok", accepted: "ok", candidate: "warn", pending: "warn", rejected: "danger" };
const JOB_TONE: Readonly<Record<string, "ok" | "warn" | "danger" | "default">> = { done: "ok", running: "warn", queued: "default", failed: "danger" };

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const short = (sha: string | undefined) => sha ? `${sha.slice(0, 12)}…` : "—";
const when = (iso: string | undefined) => iso ? new Date(iso).toLocaleString() : "—";

function Note({ tone = "muted", children }: { tone?: "muted" | "error"; children: ReactNode }) {
  return <p className={cn("text-[11px] leading-snug", tone === "error" ? "text-destructive" : "text-faint")} role={tone === "error" ? "alert" : undefined}>{children}</p>;
}

/** One size at its real pixel size, on the inventory's slot colour so the 48 reads as it will in play. */
function Tile({ src, size, label }: { src: string | undefined; size: number; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <figure className="m-0 flex flex-col items-center gap-1" data-icon-size={size}>
    <span className="grid place-items-center rounded-sm border border-border-subtle bg-[#1d1916]" style={{ width: size + 8, height: size + 8 }}>
      {src && !failed
        ? <img src={src} alt={label} width={size} height={size} style={{ width: size, height: size, imageRendering: "auto" }} onError={() => setFailed(true)} />
        : <span className="grid place-items-center text-faint [&_svg]:size-5" style={{ width: size, height: size }} title={`No ${label}`}><ImageOff /></span>}
    </span>
    <figcaption className="text-[10.5px] text-faint">{label}</figcaption>
  </figure>;
}

export function ItemIconPanel({ itemId, facts, title = "Icon" }: { itemId: string; facts: IconFacts; title?: ReactNode }) {
  const artworkId = iconArtworkId(itemId);
  const state = useIconState(artworkId);
  const urls = iconUrls(artworkId, state.version);
  const repo = repoIcons();
  const [mode, setMode] = useState<"idle" | "generate" | "upload">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = state.meta?.status ?? (state.entry ? state.entry.status : undefined);
  const prompt = state.meta?.prompt ?? state.entry?.prompt;

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); await state.refresh(); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  };
  const reviewBlocked = iconBlock("review");
  const active = state.jobs.find(job => job.status === "queued" || job.status === "running");

  return <Section title={title} aside={<span className="flex items-center gap-1">
    <Button variant={mode === "generate" ? "secondary" : "ghost"} size="xs" onClick={() => setMode(mode === "generate" ? "idle" : "generate")} title={iconBlock("generate")}>Generate</Button>
    <Button variant={mode === "upload" ? "secondary" : "ghost"} size="xs" onClick={() => setMode(mode === "upload" ? "idle" : "upload")} title={iconBlock("upload")}>Upload original</Button>
  </span>}>
    <div className="flex flex-wrap items-end gap-4 py-1" data-item-icon={artworkId}>
      <Tile src={urls.game} size={ITEM_ICON_GAME_SIZE} label="48 inventory" />
      <Tile src={urls.master} size={ITEM_ICON_MASTER_SIZE} label="256 master" />
    </div>
    {artworkId !== itemId && <Note>This item draws the icon of <code>{artworkId}</code>; changes here change that icon.</Note>}
    <Row label="Review">
      <span className="flex min-h-7 flex-wrap items-center gap-1.5">
        {status ? <Badge variant={STATUS_TONE[status] ?? "default"} data-icon-status={status}>{status}</Badge> : <Static muted>No review recorded</Static>}
        {repo && state.entry && state.meta?.status && <span className="text-[11px] text-faint">registry {state.entry.status}</span>}
        <span className="flex-1" />
        <Button variant="secondary" size="xs" disabled={busy || Boolean(reviewBlocked) || status === "approved" || status === "accepted"} title={reviewBlocked} onClick={() => void run(() => reviewIcon(artworkId, "approved"))}>Approve</Button>
        <Button variant="ghost" size="xs" disabled={busy || Boolean(reviewBlocked) || status === "rejected"} title={reviewBlocked} onClick={() => void run(() => reviewIcon(artworkId, "rejected"))}>Reject</Button>
      </span>
    </Row>
    <Row label="Prompt" align="start"><Static muted={!prompt} className="whitespace-pre-wrap text-[11px] leading-snug">{prompt ?? "No prompt recorded"}</Static></Row>
    <Row label="Original">
      <Static mono className="text-[11px]" title={state.meta?.sha256 ?? state.entry?.sha256}>
        {short(state.meta?.sha256 ?? state.entry?.sha256)}
        {repo && state.entry && <span className="text-faint"> · {state.entry.source} · {state.entry.generator}</span>}
      </Static>
    </Row>
    {(state.meta?.generatedAt || state.meta?.approvedAt) && <Row label="When"><Static>generated {when(state.meta?.generatedAt)}{state.meta?.approvedAt ? ` · approved ${when(state.meta.approvedAt)}` : ""}</Static></Row>}
    {repo && state.entry?.review && <Row label="Registry review" align="start"><Static muted className="text-[11px] leading-snug">{state.entry.review}</Static></Row>}
    <Note>{repo
      ? <>Stored icons land in the checkout (original, registry entry, 256 master, 48 icon) and ship with the next release. A new icon stays pending until approved; <code>npm run icons</code> rebuilds it from the registry.</>
      : "Storing an icon publishes it: players load it from this server's file store at once. A new icon stays a candidate until approved."}</Note>
    {mode === "generate" && <GenerateForm artworkId={artworkId} facts={facts} masterUrl={urls.master} busy={busy} onRun={run} />}
    {mode === "upload" && <UploadForm artworkId={artworkId} busy={busy} onRun={run} initialPrompt={prompt ?? ""} onDone={() => setMode("idle")} />}
    {(active || state.jobs.length > 0) && <Row label="Jobs" align="start">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {state.jobs.slice(0, 4).map(job => <li key={job.id} className="flex items-center gap-1.5 text-[11px]" data-icon-job={job.status}>
          <Badge variant={JOB_TONE[job.status] ?? "default"}>{job.status}</Badge>
          <span className="text-faint">{when(job.finishedAt ?? job.startedAt ?? job.createdAt)}</span>
          {job.error && <span className="truncate text-destructive" title={job.error}>{job.error}</span>}
        </li>)}
      </ul>
    </Row>}
    {state.error && <Note tone="error">{state.error}</Note>}
    {error && <Note tone="error">{error}</Note>}
  </Section>;
}

function GenerateForm({ artworkId, facts, masterUrl, busy, onRun }: { artworkId: string; facts: IconFacts; masterUrl: string; busy: boolean; onRun: (action: () => Promise<void>) => Promise<void> }) {
  const initial = itemIconPrompt(facts);
  const [prompt, setPrompt] = useState(initial);
  const [withReference, setWithReference] = useState(false);
  const blocked = iconBlock("generate");
  const generate = () => onRun(async () => {
    const reference = withReference ? await fetch(masterUrl, { cache: "no-store" }).then(response => response.ok ? response.blob() : undefined).catch(() => undefined) : undefined;
    await startIconJob(artworkId, facts.name, prompt.trim(), reference);
  });
  return <div className="flex flex-col gap-1.5 rounded-sm border border-border-subtle p-2" data-icon-form="generate">
    <Note>The image model paints one original from this prompt; the job trims it to the 256 master, derives the 48 icon and stores both as a candidate.</Note>
    <Textarea aria-label="Icon prompt" rows={6} className="text-xs" value={prompt} onChange={event => setPrompt(event.target.value)} />
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Checkbox checked={withReference} onCheckedChange={value => setWithReference(value === true)} aria-label="Attach the current master as a reference" /> Attach the current master as a reference</label>
    {blocked && <Note>{blocked}</Note>}
    <span className="flex items-center justify-end gap-2">
      <Button variant="ghost" size="xs" disabled={prompt === initial} onClick={() => setPrompt(initial)}>Reset prompt</Button>
      <Button variant="default" size="xs" disabled={busy || Boolean(blocked) || !prompt.trim()} title={blocked} onClick={() => void generate()}>{busy ? "Sending…" : "Generate"}</Button>
    </span>
  </div>;
}

function UploadForm({ artworkId, busy, onRun, initialPrompt, onDone }: { artworkId: string; busy: boolean; onRun: (action: () => Promise<void>) => Promise<void>; initialPrompt: string; onDone: () => void }) {
  const [upload, setUpload] = useState<IconUpload>();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const blocked = iconBlock("upload");
  useEffect(() => () => { if (upload) { URL.revokeObjectURL(upload.masterUrl); URL.revokeObjectURL(upload.gameUrl); } }, [upload]);
  const choose = async (file: File | undefined) => {
    setError(""); setUpload(undefined);
    if (!file) return;
    try { setUpload(await deriveUpload(file)); } catch (failure) { setError(errorText(failure)); }
  };
  const store = () => onRun(async () => { await storeUpload(artworkId, upload!, prompt.trim()); onDone(); });
  return <div className="flex flex-col gap-1.5 rounded-sm border border-border-subtle p-2" data-icon-form="upload">
    <Note>A generated original with a transparent background. Both sizes are derived the way <code>npm run icons</code> derives them; check them at real size before storing.</Note>
    <span className="flex items-center gap-2">
      <input ref={input} type="file" accept="image/png" className="sr-only" aria-label="Icon original" onChange={event => void choose(event.target.files?.[0])} />
      <Button variant="secondary" size="xs" disabled={Boolean(blocked)} title={blocked} onClick={() => input.current?.click()}>Choose PNG…</Button>
      {upload && <span className="truncate text-[11px] text-faint">{upload.name} · {upload.width}×{upload.height} · {upload.sha256.slice(0, 12)}…</span>}
    </span>
    {upload && <div className="flex flex-wrap items-end gap-4 py-1" data-icon-preview="">
      <Tile src={upload.gameUrl} size={ITEM_ICON_GAME_SIZE} label="48 inventory (new)" />
      <Tile src={upload.masterUrl} size={ITEM_ICON_MASTER_SIZE} label="256 master (new)" />
    </div>}
    <Textarea aria-label="Prompt that generated this original" placeholder="The exact prompt that generated this original" rows={4} className="text-xs" value={prompt} onChange={event => setPrompt(event.target.value)} />
    {blocked && <Note>{blocked}</Note>}
    {error && <Note tone="error">{error}</Note>}
    <span className="flex items-center justify-end gap-2">
      <Button variant="default" size="xs" disabled={busy || Boolean(blocked) || !upload || !prompt.trim()} title={!prompt.trim() ? "Every icon records the prompt that generated it" : blocked} onClick={() => void store()}>{busy ? "Storing…" : "Store icon"}</Button>
    </span>
  </div>;
}
