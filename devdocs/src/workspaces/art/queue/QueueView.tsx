import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import auditSource from "../../../../../docs/creature-asset-audit.md?raw";
import { apiGet, collectionQuery } from "../../../api/client.js";
import { Badge, Button, EmptyCell, SearchInput, Segmented, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableLink, TableRow } from "../../../components/ui/index.js";
import { cn } from "../../../lib/utils.js";
import { ART_VERDICT_LABEL, canReviewArt, useArtDigest, type ArtReviewCollection, type ArtSummary, type ArtVerdict } from "../../../model/artReview.js";
import { creatureBodies, creatureLooks, type CreatureDefinitionRow } from "../../../model/creatureArt.js";
import { contentRows } from "../../../model/rows.js";
import type { MetaResponse } from "../../../../shared/metaContracts.js";
import { ModelPreview } from "../../../ui/EntitySummary.js";
import { VerdictDot } from "../../../ui/FocusLayout.js";
import { COUNT, EMPTY } from "../../../ui/layout.js";
import { LoadingRows } from "../../../ui/States.js";
import { Thumb } from "../../../ui/Thumb.js";
import type { ViewProps } from "../../types.js";

/*
  The review queue: every body, variant and outfit that has a verdict or still needs one, in one
  dense table. Rows sort by how much work they hold (replace, then polish, then unreviewed), then by
  the September audit's prose verdict so its "replace" bodies come up first among the unreviewed.
  The audit column is read from docs/creature-asset-audit.md at build time and never written back.
*/

type Kind = "body" | "variant" | "outfit";
type VerdictFilter = ArtVerdict | "none";
type AuditVerdict = "keep" | "polish" | "replace";

interface AuditEntry { verdict: AuditVerdict; quality?: number; issues: string }
interface QueueRow {
  key: string; kind: Kind; id: string; name: string; detail: string;
  collection: ArtReviewCollection; review?: ArtSummary; openChecks: number;
  route: "art/creatures" | "art/outfits"; openId: string;
  assetId?: string; itemIds?: string[]; audit?: AuditEntry;
}

const KIND_LABEL: Readonly<Record<Kind, string>> = { body: "Body", variant: "Variant", outfit: "Outfit" };
const KIND_PLURAL: Readonly<Record<Kind, string>> = { body: "Bodies", variant: "Variants", outfit: "Outfits" };
const VERDICT_FILTERS: readonly { value: VerdictFilter; label: string }[] = [
  { value: "replace", label: ART_VERDICT_LABEL.replace }, { value: "polish", label: ART_VERDICT_LABEL.polish },
  { value: "none", label: "Unreviewed" }, { value: "approved", label: ART_VERDICT_LABEL.approved },
];
const DEFAULT_VERDICTS: ReadonlySet<VerdictFilter> = new Set(["replace", "polish", "none"]);
const VERDICT_RANK: Readonly<Record<VerdictFilter, number>> = { replace: 0, polish: 1, none: 2, approved: 3 };
const AUDIT_RANK: Readonly<Record<AuditVerdict, number>> = { replace: 0, polish: 1, keep: 2 };
const AUDIT_TONE: Readonly<Record<AuditVerdict, "danger" | "warn" | "ok">> = { replace: "danger", polish: "warn", keep: "ok" };

/** Model → prose verdict from the "Complete model list" table of the September audit. */
function parseAudit(source: string): ReadonlyMap<string, AuditEntry> {
  const out = new Map<string, AuditEntry>();
  const start = source.indexOf("## Complete model list");
  if (start < 0) return out;
  const next = source.indexOf("\n## ", start + 1);
  for (const line of source.slice(start, next < 0 ? undefined : next).split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.slice(1, -1).split("|").map(cell => cell.trim().replaceAll("`", ""));
    const verdict = cells[3]?.toLowerCase();
    if (!cells[0] || (verdict !== "keep" && verdict !== "polish" && verdict !== "replace")) continue;
    const quality = Number(cells[2]);
    out.set(cells[0], { verdict, quality: Number.isFinite(quality) ? quality : undefined, issues: cells[4] ?? "" });
  }
  return out;
}
const AUDIT = parseAudit(auditSource);

const openChecksOf = (review: ArtSummary | undefined): number => Object.values(review?.checks ?? {}).filter(verdict => verdict !== "approved").length;
const verdictOf = (row: QueueRow): VerdictFilter => row.review?.verdict ?? "none";

export default function QueueView({ navigate }: ViewProps) {
  const definitions = useQuery(collectionQuery("creatureDefinitions"));
  const sets = useQuery(collectionQuery("equipmentSets"));
  const bodyDigest = useArtDigest("assets");
  const variantDigest = useArtDigest("creatureDefinitions");
  const outfitDigest = useArtDigest("equipmentSets");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [verdicts, setVerdicts] = useState<ReadonlySet<VerdictFilter>>(DEFAULT_VERDICTS);
  const [search, setSearch] = useState("");

  const rows = useMemo<QueueRow[]>(() => {
    const defs = (definitions.data ? contentRows(definitions.data) : []) as unknown as CreatureDefinitionRow[];
    const out: QueueRow[] = [];
    for (const body of creatureBodies(defs)) {
      const review = bodyDigest.data.get(body.assetId);
      const names = [...new Set(body.looks.map(look => look.name))];
      out.push({ key: `body:${body.assetId}`, kind: "body", id: body.assetId, name: names[0] ?? body.assetId, detail: `${body.assetId} · ${names.length > 1 ? `${names.length} names, ` : ""}${body.looks.length} ${body.looks.length === 1 ? "definition" : "definitions"}`,
        collection: "assets", review, openChecks: openChecksOf(review), route: "art/creatures", openId: body.assetId, assetId: body.assetId, audit: AUDIT.get(body.assetId) });
    }
    // A variant is worth its own row when it wears a body under a base, or when someone reviewed it.
    for (const look of creatureLooks(defs)) {
      const review = variantDigest.data.get(look.creatureId);
      if (!look.assetId || (!look.baseId && !review)) continue;
      out.push({ key: `variant:${look.creatureId}`, kind: "variant", id: look.creatureId, name: look.name, detail: `${look.creatureId} · level ${look.level}${look.inherited ? " · wears its base" : ""}`,
        collection: "creatureDefinitions", review, openChecks: openChecksOf(review), route: "art/creatures", openId: look.creatureId, assetId: look.assetId });
    }
    for (const set of (sets.data ? contentRows(sets.data) : []) as { id: string; name?: string; tier?: number; style?: string; members?: Record<string, string | undefined> }[]) {
      const review = outfitDigest.data.get(set.id);
      const itemIds = Object.values(set.members ?? {}).filter((id): id is string => Boolean(id));
      out.push({ key: `outfit:${set.id}`, kind: "outfit", id: set.id, name: set.name ?? set.id, detail: [`tier ${set.tier ?? 0}`, set.style, `${itemIds.length} of 5 pieces`].filter(Boolean).join(" · "),
        collection: "equipmentSets", review, openChecks: openChecksOf(review), route: "art/outfits", openId: set.id, itemIds });
    }
    return out.sort((a, b) => VERDICT_RANK[verdictOf(a)] - VERDICT_RANK[verdictOf(b)] || b.openChecks - a.openChecks
      || (a.audit ? AUDIT_RANK[a.audit.verdict] : 3) - (b.audit ? AUDIT_RANK[b.audit.verdict] : 3) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }, [definitions.data, sets.data, bodyDigest.data, variantDigest.data, outfitDigest.data]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter(row => (kind === "all" || row.kind === kind) && verdicts.has(verdictOf(row))
      && (!needle || `${row.name} ${row.id} ${row.detail}`.toLowerCase().includes(needle)));
  }, [rows, kind, verdicts, search]);
  const notes = useNotes(shown);
  const counts = useMemo(() => {
    const byKind = new Map<string, number>();
    for (const row of rows) if (verdicts.has(verdictOf(row))) byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + 1);
    return byKind;
  }, [rows, verdicts]);
  const open = (row: QueueRow) => navigate(row.route, row.openId);
  const toggleVerdict = (value: VerdictFilter) => setVerdicts(current => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });

  if (definitions.isPending || sets.isPending) return <div className="p-4"><LoadingRows /></div>;
  return <div className="art-queue flex h-full min-h-0 flex-1 flex-col">
    <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-1.5">
      <SearchInput label="Search the queue" shortcut placeholder="Search name or id…" value={search} onChange={setSearch} onEnter={() => { const first = shown[0]; if (first) open(first); }} />
      <Segmented aria-label="Kind">
        {(["all", "body", "variant", "outfit"] as const).map(value => <Button key={value} variant="segment" size="xs" aria-pressed={kind === value} onClick={() => setKind(value)}>
          {value === "all" ? "All" : KIND_PLURAL[value]}{value !== "all" && <small className="font-mono text-faint">{counts.get(value) ?? 0}</small>}
        </Button>)}
      </Segmented>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Verdict">
        {VERDICT_FILTERS.map(filter => <Button key={filter.value} variant="chip" size="xs" aria-pressed={verdicts.has(filter.value)} onClick={() => toggleVerdict(filter.value)}>
          {filter.value !== "none" && <VerdictDot verdict={filter.value} />}{filter.label}
        </Button>)}
      </div>
      <span className={COUNT}>{shown.length === rows.length ? rows.length : `${shown.length} of ${rows.length}`}</span>
    </div>
    {!canReviewArt() && <p className={cn(EMPTY, "px-3")}>Verdicts are stored in the repository's dev metadata; this build cannot read them, so every row reads as unreviewed.</p>}
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {shown.length === 0
        ? <p className={EMPTY}>Nothing in the queue matches these filters.</p>
        : <TableFrame className="w-full overflow-visible">
          <Table className="table-fixed">
            <colgroup><col className="w-12" /><col className="w-80" /><col className="w-20" /><col className="w-28" /><col className="w-24" /><col className="w-28" /><col /></colgroup>
            <TableHeader><TableRow>
              <TableHead><span className="sr-only">Picture</span></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Verdict</TableHead>
              <TableHead numeric>Open checks</TableHead>
              <TableHead title="Prose verdicts from docs/creature-asset-audit.md, read only">Audit (Sept)</TableHead>
              <TableHead>Note</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {shown.map(row => {
                const verdict = row.review?.verdict;
                const note = notes.get(`${row.collection}:${row.id}`);
                return <TableRow key={row.key} className="cursor-pointer" data-kind={row.kind} data-id={row.id} onClick={() => open(row)}>
                  <TableCell className="py-0.5">
                    {row.itemIds ? <Thumb spec={{ kind: "items", ids: row.itemIds }} size="m" alt="" /> : row.assetId ? <ModelPreview assetId={row.assetId} text="" className="size-8" /> : <EmptyCell />}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <TableLink className="flex-col items-start gap-0" onClick={event => { event.stopPropagation(); open(row); }}>
                      <span className="truncate font-medium">{row.name}</span>
                      <span className="w-full truncate font-mono text-[11px] text-faint" title={row.detail}>{row.detail}</span>
                    </TableLink>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{KIND_LABEL[row.kind]}</TableCell>
                  <TableCell>{verdict ? <span className="inline-flex items-center gap-1.5"><VerdictDot verdict={verdict} />{ART_VERDICT_LABEL[verdict]}</span> : <span className="text-faint">Unreviewed</span>}</TableCell>
                  <TableCell numeric>{row.openChecks || <EmptyCell />}</TableCell>
                  <TableCell>{row.audit
                    ? <span className="inline-flex items-center gap-1.5" title={row.audit.issues}><Badge variant={AUDIT_TONE[row.audit.verdict]}>{row.audit.verdict}</Badge>{row.audit.quality !== undefined && <span className="font-mono text-[11px] text-faint">{row.audit.quality}/5</span>}</span>
                    : <EmptyCell />}</TableCell>
                  <TableCell className="max-w-0 truncate text-muted-foreground" title={note ?? row.audit?.issues}>{note ?? (row.audit?.issues ? <span className="text-faint">{row.audit.issues}</span> : <EmptyCell />)}</TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
        </TableFrame>}
    </div>
  </div>;
}

/**
 * The note on each reviewed row. The digest carries verdicts only, so a reviewed row's note is read
 * from its own metadata record; unreviewed rows cost nothing.
 */
function useNotes(rows: readonly QueueRow[]): ReadonlyMap<string, string> {
  const reviewed = rows.filter(row => row.review && (row.review.verdict || Object.keys(row.review.checks).length));
  const queries = useQueries({ queries: reviewed.map(row => ({
    queryKey: ["art-queue-note", row.collection, row.id],
    queryFn: () => apiGet<MetaResponse>(`meta/${encodeURIComponent(row.collection)}/${encodeURIComponent(row.id)}`),
    enabled: canReviewArt(), staleTime: 15_000, refetchOnWindowFocus: false, retry: false,
  })) });
  const notes = new Map<string, string>();
  reviewed.forEach((row, index) => {
    const art = queries[index]?.data?.data.art;
    const text = art?.note ?? Object.values(art?.checks ?? {}).find(check => check.note)?.note;
    if (text) notes.set(`${row.collection}:${row.id}`, text.replace(/\s+/g, " ").trim());
  });
  return notes;
}
