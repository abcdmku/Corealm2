import { useMemo, useState } from "react";
import { Button, Segmented } from "../../../components/ui/index.js";
import { cn } from "../../../lib/utils.js";
import { ART_VERDICT_LABEL, ART_VERDICTS, useArtDigest, type ArtSummary } from "../../../model/artReview.js";
import { VerdictDot } from "../../../ui/FocusLayout.js";
import { Thumb } from "../../../ui/Thumb.js";
import { SET_SLOTS, type ItemsData, type SetRecord } from "../../items/data.js";
import type { ViewProps } from "../../types.js";
import { COLUMNS, PIECE_LABEL, columnOf, tierHandIcons } from "./outfits.js";

/*
  The worn-gear ladder: tiers down, crafted melee / crafted magic / boss melee / boss magic across.
  A cell is one set's five pieces with the verdict on each and on the set; click it to review.
*/

const HANDS_KEY = "devdocs.art.outfits.hands";
const loadHands = (): boolean => { try { return localStorage.getItem(HANDS_KEY) === "1"; } catch { return false; } };

export function OutfitMatrix({ data, navigate }: { data: ItemsData; navigate: ViewProps["navigate"] }) {
  const digest = useArtDigest("equipmentSets");
  const [hands, setHands] = useState(loadHands);
  const chooseHands = (next: boolean) => { setHands(next); try { localStorage.setItem(HANDS_KEY, next ? "1" : "0"); } catch { /* optional */ } };
  const rows = useMemo(() => {
    const tiers = [...new Set(data.sets.map(set => set.tier ?? 0))].sort((a, b) => a - b);
    return tiers.map(tier => ({ tier, row: data.tiers.find(entry => entry.tier === tier), cells: COLUMNS.map(column => data.sets.filter(set => (set.tier ?? 0) === tier && columnOf(set) === column)) }));
  }, [data.sets, data.tiers]);
  const counts = ART_VERDICTS.map(verdict => ({ verdict, count: data.sets.filter(set => digest.data.get(set.id)?.verdict === verdict).length }));
  const unreviewed = data.sets.filter(set => !digest.data.get(set.id)?.verdict).length;

  return <div className="@container flex h-full min-h-0 flex-col overflow-y-auto px-4 pt-3 pb-4">
    <div className="mb-2.5 flex min-h-7 flex-wrap items-center gap-3">
      <h1 className="text-[15px] font-semibold">Outfits</h1>
      <span className="inline-flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{data.sets.length} sets</span>
        {counts.map(({ verdict, count }) => <span key={verdict} className="inline-flex items-center gap-1.5"><VerdictDot verdict={verdict} />{count} {ART_VERDICT_LABEL[verdict].toLowerCase()}</span>)}
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-1.5 rounded-full border border-faint" />{unreviewed} unreviewed</span>
      </span>
      <Segmented className="ml-auto" aria-label="Hands">
        <Button variant="segment" size="xs" aria-pressed={!hands} onClick={() => chooseHands(false)}>Armour</Button>
        <Button variant="segment" size="xs" aria-pressed={hands} onClick={() => chooseHands(true)} title="Add the tier's weapons beside each crafted set">With weapons</Button>
      </Segmented>
    </div>
    <div className="grid w-full max-w-[150rem] grid-cols-[3.25rem_repeat(4,minmax(0,1fr))] gap-x-1.5 text-xs" role="table" aria-label="Outfit ladder">
      <div role="row" className="contents">
        <span role="columnheader" className="px-1 text-[11px] text-faint">Tier</span>
        {COLUMNS.map(column => <span key={column.key} role="columnheader" className={cn("px-1.5 text-[11px] font-semibold tracking-[.04em] text-faint uppercase", column.key === "boss-melee" && "ml-2")}>{column.label}</span>)}
      </div>
      {rows.map(({ tier, row, cells }) => <div key={tier} role="row" className="contents">
        <span role="rowheader" className="flex flex-col justify-center border-t border-border-subtle px-1 leading-tight">
          <strong className="text-[15px] text-foreground">{tier}</strong>
          {row && <small className="text-[11px] text-faint">lvl {row.reqLevel}</small>}
        </span>
        {cells.map((sets, index) => {
          const column = COLUMNS[index]!;
          return <div key={column.key} role="cell" className={cn("flex min-h-[3.75rem] flex-col justify-center gap-1 border-t border-border-subtle py-1", column.key === "boss-melee" && "ml-2")}>
            {sets.map(set => <SetCell key={set.id} set={set} summary={digest.data.get(set.id)} hands={hands && !column.boss ? tierHandIcons(row, column.style) : []} small={hands} data={data} onOpen={() => navigate("art/outfits", set.id)} />)}
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}

/** `small`: weapons share the cell, so the name moves to the tooltip and, in a narrow window, the icons shrink. */
function SetCell({ set, summary, hands, small, data, onOpen }: { set: SetRecord; summary: ArtSummary | undefined; hands: string[]; small: boolean; data: ItemsData; onOpen: () => void }) {
  const name = (id: string) => data.item(id)?.name ?? id;
  const icon = small ? "@max-[80rem]:size-[22px]" : "@min-[140rem]:size-11";
  return <button type="button" onClick={onOpen} data-set={set.id} title={`${set.name} · tier ${set.tier ?? 0} · ${set.style} · ${set.acquisition}`}
    className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/35">
    <span className="flex shrink-0 items-start gap-1">
      {SET_SLOTS.map(slot => {
        const id = set.members?.[slot];
        const verdict = summary?.checks[`slot:${slot}`];
        return <span key={slot} className="flex flex-col items-center gap-0.5" title={id ? `${PIECE_LABEL[slot]}: ${name(id)}` : `${PIECE_LABEL[slot]}: none`}>
          {id ? <Thumb spec={{ kind: "item", id }} size="m" alt={name(id)} className={icon} /> : <span className={cn("size-8 rounded-sm border border-dashed border-border-subtle", icon)} />}
          <span className="flex h-1.5 items-center">{verdict && <VerdictDot verdict={verdict} />}</span>
        </span>;
      })}
      {hands.length > 0 && <span className="ml-1 flex items-start gap-1 border-l border-border-subtle pl-1.5">
        {hands.map(id => <span key={id} className="flex flex-col items-center gap-0.5" title={name(id)}><Thumb spec={{ kind: "item", id }} size="m" alt={name(id)} className={icon} /><span className="h-1.5" /></span>)}
      </span>}
    </span>
    <span className="flex min-w-1.5 flex-1 items-center gap-1.5 self-start pt-3">
      {summary?.verdict ? <VerdictDot verdict={summary.verdict} /> : <span className="inline-block size-1.5 shrink-0 rounded-full border border-faint" title="Unreviewed" />}
      <span className={cn("truncate text-[11px] text-foreground @max-[62rem]:hidden", small && "hidden")}>{set.name}</span>
    </span>
  </button>;
}
