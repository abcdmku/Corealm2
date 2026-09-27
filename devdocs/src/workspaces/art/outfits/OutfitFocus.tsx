import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { MetaResponse } from "../../../../shared/metaContracts.js";
import { gearAppearanceParts } from "../../../../../game/src/render/equipmentVisuals.js";
import { Button, Kbd, Segmented, Textarea } from "../../../components/ui/index.js";
import { cn } from "../../../lib/utils.js";
import { canReviewArt, useArtDigest, useArtReview, type ArtVerdict } from "../../../model/artReview.js";
import { FocusLayout, StateStrip, StripRow, VerdictBar, VerdictDot, humanize, type StateItem } from "../../../ui/FocusLayout.js";
import { Thumb } from "../../../ui/Thumb.js";
import { AssetViewer, type ViewerSnapshot, type ViewerSource } from "../../../viewer/AssetViewer.js";
import { SET_SLOTS, thresholdText, type ItemsData, type SetRecord } from "../../items/data.js";
import type { ViewProps } from "../../types.js";
import { HAND_SLOTS, PIECE_LABEL, orderSets, setIcon, styleLadder, tierHands, tintHex, type PieceKey } from "./outfits.js";

/*
  One outfit on the production rig: the set's pieces and its tier's weapons on either body, in
  every player pose, with a verdict on the set and on each pose, body and piece.
*/

type Body = "male" | "female";
const BODIES: readonly Body[] = ["male", "female"];
const RUNGS = 9;

/** The review choices that carry over from one set to the next, so a reviewer can walk the ladder in one pose. */
interface Review { body: Body; pose: string; hidden: ReadonlySet<PieceKey>; focus: PieceKey }

export function OutfitFocus({ id, data, navigate }: { id: string; data: ItemsData; navigate: ViewProps["navigate"] }) {
  const sets = useMemo(() => orderSets(data.sets), [data.sets]);
  const set = sets.find(candidate => candidate.id === id);
  const digest = useArtDigest("equipmentSets");
  const review = useArtReview("equipmentSets", set?.id);
  const [view, setView] = useState<Review>({ body: "male", pose: "idle", hidden: new Set(), focus: "body" });
  const [reported, setReported] = useState<{ key: string; snapshot: ViewerSnapshot }>();
  const open = useCallback((next: SetRecord | undefined) => { if (next) navigate("art/outfits", next.id); }, [navigate]);

  const ladder = useMemo(() => styleLadder(data.sets, set?.style), [data.sets, set?.style]);
  const hands = useMemo(() => tierHands(data.tiers.find(tier => tier.tier === set?.tier), set?.style), [data.tiers, set?.tier, set?.style]);
  const pieces = useMemo(() => {
    const out: { key: PieceKey; id: string }[] = SET_SLOTS.flatMap(slot => set?.members?.[slot] ? [{ key: slot, id: set.members[slot]! }] : []);
    for (const slot of HAND_SLOTS) if (hands[slot]) out.push({ key: slot, id: hands[slot]! });
    return out;
  }, [set, hands]);
  const shown = (key: PieceKey) => !view.hidden.has(key);
  const pieceId = (key: PieceKey) => pieces.find(piece => piece.key === key)?.id;
  const source = useMemo<ViewerSource>(() => ({
    mode: "outfit", body: view.body,
    itemIds: pieces.filter(piece => !HAND_SLOTS.includes(piece.key as never) && !view.hidden.has(piece.key)).map(piece => piece.id),
    mainHandId: view.hidden.has("mainHand") ? undefined : hands.mainHand,
    offHandId: view.hidden.has("offHand") ? undefined : hands.offHand,
  }), [pieces, hands, view.body, view.hidden]);
  // A new source reloads the rig: a snapshot only counts for the source it was reported for.
  const sourceKey = JSON.stringify(source);
  const onSnapshot = useCallback((next: ViewerSnapshot) => setReported({ key: sourceKey, snapshot: next }), [sourceKey]);
  const snapshot = reported?.key === sourceKey && reported.snapshot.ready ? reported.snapshot : undefined;

  const choosePose = useCallback((pose: string) => setView(current => ({ ...current, pose })), []);
  const chooseBody = useCallback((body: Body) => setView(current => ({ ...current, body })), []);
  const toggle = (key: PieceKey) => setView(current => {
    const hidden = new Set(current.hidden);
    if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
    return { ...current, hidden, focus: key };
  });
  const focusPiece = (key: PieceKey) => setView(current => ({ ...current, focus: key }));
  const setVerdict = useCallback((verdict: ArtVerdict | "clear") => review.review({ verdict }), [review]);

  const index = set ? sets.indexOf(set) : -1;
  const rung = set ? ladder.indexOf(set) : -1;
  /** The strip shows the nine rungs around this one; `[` and `]` walk the whole ladder. */
  const rungStart = Math.max(0, Math.min(rung - Math.floor(RUNGS / 2), ladder.length - RUNGS));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || isEditable(event.target)) return;
      const key = event.key;
      const step = (delta: number) => { event.preventDefault(); open(sets[index + delta]); };
      if (event.altKey) { if (key === "ArrowDown") step(1); else if (key === "ArrowUp") step(-1); return; }
      if (key === "j" || key === "J") step(1);
      else if (key === "k" || key === "K") step(-1);
      else if (key === "]") { event.preventDefault(); open(ladder[rung + 1]); }
      else if (key === "[") { event.preventDefault(); open(ladder[rung - 1]); }
      else if (key === "m" || key === "M") { event.preventDefault(); chooseBody("male"); }
      else if (key === "f" || key === "F") { event.preventDefault(); chooseBody("female"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sets, index, ladder, rung, open, chooseBody]);

  const checks = digest.data.get(set?.id ?? "")?.checks ?? {};
  const check = (key: string): ArtVerdict | undefined => set ? review.verdict(key) ?? checks[key] : undefined;
  const states: StateItem[] = (snapshot?.states ?? []).map(state => ({ name: state.name, available: state.available, synthetic: state.synthetic, verdict: check(`pose:${state.name}`) }));
  const editable = canReviewArt();

  const list = <SetList sets={sets} current={set?.id} digest={digest.data} data={data} onOpen={open} />;
  if (!set) return <FocusLayout list={list} header={<span className="text-xs text-faint">"{id}" is not an armour set.</span>}
    stage={<div className="grid h-full place-items-center text-xs text-faint"><Button variant="link" size="sm" onClick={() => navigate("art/outfits")}>All outfits</Button></div>} />;

  const header = <>
    <Thumb spec={{ kind: "item", id: setIcon(set) ?? "" }} size="m" alt="" />
    <div className="flex min-w-0 flex-col leading-tight">
      <h1 className="truncate text-sm font-semibold">{set.name}</h1>
      <span className="truncate text-[11px] text-muted-foreground">Tier {set.tier ?? 0} · {humanize(set.style ?? "")} · {humanize(set.acquisition ?? "")}</span>
    </div>
    <div className="ml-auto flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => navigate("art/outfits")}>Ladder</Button>
      <VerdictBar value={review.verdict()} onChange={setVerdict} hotkeys disabled={!editable} />
    </div>
  </>;

  const stage = <AssetViewer source={source} stage controls={false} state={view.pose} onSnapshot={onSnapshot} label={`${set.name} on the ${view.body} rig`} />;

  const strip = <>
    <StripRow label="Poses">{states.length ? <StateStrip states={states} value={snapshot?.state ?? view.pose} onChange={choosePose} /> : <span className="text-[11px] text-faint">Loading the rig…</span>}</StripRow>
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
      <StripRow label="Body" className="flex-none">
        <Segmented aria-label="Body">
          {BODIES.map(body => <Button key={body} variant="segment" size="xs" aria-pressed={view.body === body} onClick={() => chooseBody(body)} data-body={body}>
            <Kbd className="h-4 min-w-4 px-0.5 text-[10px]">{body === "male" ? "M" : "F"}</Kbd>{humanize(body)}{check(`body:${body}`) && <VerdictDot verdict={check(`body:${body}`)!} />}
          </Button>)}
        </Segmented>
      </StripRow>
      <StripRow label="Pieces" className="flex-none">
        {pieces.map(piece => {
          const verdict = check(`slot:${piece.key}`);
          const name = data.item(piece.id)?.name ?? piece.id;
          return <Button key={piece.key} variant="ghost" size="sm" className={cn("h-9 gap-1 px-1", piece.key === "mainHand" && "ml-2")}
            aria-pressed={shown(piece.key)} data-piece={piece.key} title={`${PIECE_LABEL[piece.key]}: ${name} · ${shown(piece.key) ? "shown, click to hide" : "hidden, click to show"}`}
            onClick={() => toggle(piece.key)}>
            <Thumb spec={{ kind: "item", id: piece.id }} size="m" alt={name} className={cn(!shown(piece.key) && "opacity-35 grayscale")} />
            {verdict && <VerdictDot verdict={verdict} />}
          </Button>;
        })}
      </StripRow>
    </div>
    <StripRow label="Tier">
      <Kbd className="h-4 min-w-4 px-0.5 text-[10px]">[</Kbd>
      {ladder.slice(rungStart, rungStart + RUNGS).map(rungSet => {
        const verdict = digest.data.get(rungSet.id)?.verdict;
        return <Button key={rungSet.id} variant="ghost" size="sm" className="h-7 gap-1 px-1" aria-pressed={rungSet.id === set.id} title={`${rungSet.name} · tier ${rungSet.tier ?? 0}${rungSet.acquisition === "boss" ? " · boss" : ""}`}
          onClick={() => open(rungSet)} data-rung={rungSet.id}>
          <Thumb spec={{ kind: "item", id: setIcon(rungSet) ?? "" }} size="s" alt="" />
          <span className="font-mono text-[11px]">{rungSet.tier ?? 0}{rungSet.acquisition === "boss" && "b"}</span>
          {verdict && <VerdictDot verdict={verdict} />}
        </Button>;
      })}
      <Kbd className="h-4 min-w-4 px-0.5 text-[10px]">]</Kbd>
    </StripRow>
  </>;

  const inspector = <Inspector set={set} data={data} review={review} editable={editable} body={view.body} pose={snapshot?.state ?? view.pose}
    focus={view.focus} focusId={pieceId(view.focus)} pieces={pieces} onFocus={focusPiece} snapshot={snapshot} navigate={navigate} />;

  return <FocusLayout list={list} header={header} stage={stage} strip={strip} inspector={inspector} />;
}

function SetList({ sets, current, digest, data, onOpen }: { sets: SetRecord[]; current?: string; digest: ReturnType<typeof useArtDigest>["data"]; data: ItemsData; onOpen: (set: SetRecord) => void }) {
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current?.scrollIntoView({ block: "nearest" }); }, [current]);
  const tiers = [...new Set(sets.map(set => set.tier ?? 0))];
  return <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1.5">
    {tiers.map(tier => <div key={tier} className="flex flex-col px-1.5 pb-1">
      <h2 className="px-1.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-[.04em] text-faint uppercase">Tier {tier}</h2>
      {sets.filter(set => (set.tier ?? 0) === tier).map(set => {
        const verdict = digest.get(set.id)?.verdict;
        const icon = setIcon(set);
        return <Button key={set.id} ref={set.id === current ? active : undefined} variant="ghost" size="sm" className="h-7 justify-start gap-2 px-1.5" aria-pressed={set.id === current}
          aria-current={set.id === current ? "page" : undefined} onClick={() => onOpen(set)} data-set={set.id}>
          {icon && <Thumb spec={{ kind: "item", id: icon }} size="s" alt="" />}
          <span className="min-w-0 flex-1 truncate text-left">{set.name}</span>
          <span className="text-[10px] text-faint">{set.style === "magic" ? "magic" : "melee"}{set.acquisition === "boss" ? " · boss" : ""}</span>
          {verdict ? <VerdictDot verdict={verdict} /> : <span className="inline-block size-1.5 shrink-0" />}
        </Button>;
      })}
    </div>)}
  </div>;
}

interface InspectorProps {
  set: SetRecord; data: ItemsData; review: ReturnType<typeof useArtReview>; editable: boolean; body: Body; pose: string;
  focus: PieceKey; focusId: string | undefined; pieces: { key: PieceKey; id: string }[]; onFocus: (key: PieceKey) => void;
  snapshot: ViewerSnapshot | undefined; navigate: ViewProps["navigate"];
}

function Inspector({ set, data, review, editable, body, pose, focus, focusId, pieces, onFocus, snapshot, navigate }: InspectorProps) {
  const client = useQueryClient();
  const approvals = client.getQueryData<MetaResponse>(["art", "equipmentSets", set.id])?.data.approvals;
  const item = focusId ? data.item(focusId) : undefined;
  const parts = focusId ? gearAppearanceParts(focusId, body) : [];
  const slotKey = `slot:${focus}`;
  return <div className="flex min-h-full flex-col gap-2.5 p-3 text-xs">
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        {pieces.map(piece => <Button key={piece.key} variant="ghost" size="icon" className="size-8 p-0" aria-pressed={piece.key === focus} title={PIECE_LABEL[piece.key]} onClick={() => onFocus(piece.key)} data-focus={piece.key}>
          <Thumb spec={{ kind: "item", id: piece.id }} size="s" alt={PIECE_LABEL[piece.key]} />
        </Button>)}
      </div>
      {focusId ? <div className="flex gap-2.5">
        <Thumb spec={{ kind: "item", id: focusId }} size="xl" alt={item?.name ?? focusId} className="size-20" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] text-faint">{PIECE_LABEL[focus]}</span>
          <strong className="truncate text-[13px] font-semibold text-foreground">{item?.name ?? focusId}</strong>
          <code className="truncate font-mono text-[11px] text-faint">{focusId}</code>
          <Button variant="link" size="xs" className="justify-start" onClick={() => navigate("items/catalog", focusId)}>Item page</Button>
        </div>
      </div> : <p className="text-faint">This set has no {PIECE_LABEL[focus].toLowerCase()} piece.</p>}
      {focusId && <div className="flex flex-col gap-0.5 rounded-md bg-card px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
        {parts.length ? parts.map((part, at) => <span key={at} className="flex min-w-0 flex-wrap items-center gap-x-1.5">
          <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">{part.assetId}</span>
          <span className="shrink-0 text-faint">{part.attach === "skin" ? "skinned" : "on a bone"}</span>
          {part.tint !== undefined && <span className="inline-flex shrink-0 items-center gap-1"><span className="inline-block size-2.5 rounded-[3px] border border-border" style={{ background: tintHex(part.tint) }} />{tintHex(part.tint)}</span>}
        </span>) : <span className="text-destructive">No worn mesh registered for the {body} body</span>}
        {snapshot?.attachments.filter(attachment => attachment.slot === focus).map(attachment => <span key={attachment.slot} className="truncate text-faint">on {attachment.bone}</span>)}
      </div>}
      {focusId && <AspectVerdict label={`${PIECE_LABEL[focus]} piece`} aspect={slotKey} review={review} editable={editable} withNote />}
    </section>
    <section className="flex flex-col gap-1.5 border-t border-border-subtle pt-2.5">
      <AspectVerdict label={`Pose · ${humanize(pose)}`} aspect={`pose:${pose}`} review={review} editable={editable} />
      <AspectVerdict label={`Body · ${humanize(body)}`} aspect={`body:${body}`} review={review} editable={editable} />
    </section>
    <section className="flex flex-col gap-1 border-t border-border-subtle pt-2.5">
      <span className="truncate font-mono text-[11px] text-muted-foreground" title={thresholdText(set.thresholds)}>{thresholdText(set.thresholds) || "No set bonuses"}</span>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-faint">Sign-off</span>
        {BODIES.map(value => <span key={value} className={cn("inline-flex items-center gap-1 text-[11px]", approvals?.[value] ? "text-ok" : "text-faint")}>
          <span className={cn("inline-block size-1.5 rounded-full", approvals?.[value] ? "bg-ok" : "border border-faint")} />{humanize(value)}
        </span>)}
        <Button variant="link" size="xs" className="ml-auto" onClick={() => navigate("items/sets", set.id)}>Edit set <ArrowRight /></Button>
      </div>
    </section>
    <footer className="mt-auto flex flex-wrap gap-x-2.5 gap-y-1 border-t border-border-subtle pt-2 text-[10px] text-faint">
      {[["1–9", "pose"], ["M F", "body"], ["[ ]", "tier"], ["J K", "set"], ["A P R", "verdict"]].map(([keys, label]) => <span key={label} className="inline-flex items-center gap-1"><Kbd className="h-4 px-1 text-[10px]">{keys}</Kbd>{label}</span>)}
    </footer>
  </div>;
}

function AspectVerdict({ label, aspect, review, editable, withNote = false }: { label: string; aspect: string; review: ReturnType<typeof useArtReview>; editable: boolean; withNote?: boolean }) {
  const saved = review.note(aspect) ?? "";
  const [note, setNote] = useState(saved);
  useEffect(() => setNote(saved), [saved, aspect]);
  return <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate text-[11px] text-muted-foreground">{label}</span>
      <VerdictBar size="xs" value={review.verdict(aspect)} disabled={!editable} onChange={verdict => review.review({ key: aspect, verdict })} />
    </div>
    {withNote && <Textarea rows={2} className="min-h-0 resize-none text-[11px]" placeholder="Note on this piece" value={note} disabled={!editable} aria-label={`${label} note`}
      onChange={event => setNote(event.target.value)} onBlur={() => { if (note !== saved) review.review({ key: aspect, note }); }} />}
  </div>;
}

function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)));
}
