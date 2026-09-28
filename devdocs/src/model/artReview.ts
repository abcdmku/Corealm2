/**
 * Art review verdicts, stored in the authoring metadata beside the content: the checkout's metadata
 * files in repo mode, the server's own store on a live server.
 *
 * A verdict sits on a whole record (`key` absent) or on one aspect of it, keyed `<kind>:<name>`:
 * `state:death`, `pose:mine`, `body:female`, `slot:head`, `variant:<creatureId>`. Bodies are
 * reviewed on the `assets` collection by manifest id; variants on `creatureDefinitions`; outfits on
 * `equipmentSets`; single worn items on `items`; skins on `creatureSkins`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { can } from "../api/backend.js";
import type { ArtVerdict, MetaPatch, MetaRecord, MetaResponse } from "../../shared/metaContracts.js";
import { isMetaConflict, readMeta, readMetaDigest, writeMeta } from "./meta.js";

export type { ArtVerdict } from "../../shared/metaContracts.js";
export const ART_VERDICTS: readonly ArtVerdict[] = ["approved", "polish", "replace"];
export const ART_VERDICT_LABEL: Readonly<Record<ArtVerdict, string>> = { approved: "Approved", polish: "Needs polish", replace: "Replace" };
/** Badge tone per verdict, for `toneVariant`. */
export const ART_VERDICT_TONE: Readonly<Record<ArtVerdict, "ok" | "warn" | "danger">> = { approved: "ok", polish: "warn", replace: "danger" };

export type ArtReviewCollection = "assets" | "creatureDefinitions" | "creatureSkins" | "equipmentSets" | "items";
export type ArtRecord = NonNullable<MetaRecord["art"]>;
export interface ArtSummary { verdict?: ArtVerdict; checks: Readonly<Record<string, ArtVerdict>> }

const recordKey = (collection: string, id: string) => ["art", collection, id] as const;
const digestKey = (collection: string) => ["art-digest", collection] as const;

/** Whether this backend can read and write review metadata. */
export function canReviewArt(): boolean { return can("meta"); }

/** Every record's verdicts in a collection, for badging lists and queues. One request per collection. */
export function useArtDigest(collection: ArtReviewCollection): { data: ReadonlyMap<string, ArtSummary>; isPending: boolean } {
  const query = useQuery({
    queryKey: digestKey(collection),
    queryFn: () => readMetaDigest(collection),
    enabled: canReviewArt(), staleTime: 15_000, refetchOnWindowFocus: false, retry: false,
  });
  const data = new Map<string, ArtSummary>();
  for (const [id, entry] of Object.entries(query.data?.records ?? {})) {
    if (entry.art || entry.artChecks) data.set(id, { verdict: entry.art, checks: entry.artChecks ?? {} });
  }
  return { data, isPending: query.isPending && canReviewArt() };
}

export interface ArtReviewOperation { key?: string; verdict?: ArtVerdict | "clear"; note?: string }

/** One record's review, and a setter that writes verdicts and notes with optimistic updates. */
export function useArtReview(collection: ArtReviewCollection, id: string | undefined) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: recordKey(collection, id ?? ""),
    queryFn: () => readMeta(collection, id!),
    enabled: canReviewArt() && Boolean(id), staleTime: 10_000, refetchOnWindowFocus: false, retry: false,
  });
  const mutation = useMutation({
    mutationFn: async (operation: ArtReviewOperation) => {
      const current = client.getQueryData<MetaResponse>(recordKey(collection, id!)) ?? await readMeta(collection, id!);
      const patch: MetaPatch = { revision: current.revision, operation: { kind: "art", ...operation } };
      return writeMeta(collection, id!, patch);
    },
    onMutate: async operation => {
      await client.cancelQueries({ queryKey: recordKey(collection, id!) });
      const previous = client.getQueryData<MetaResponse>(recordKey(collection, id!));
      if (previous) client.setQueryData(recordKey(collection, id!), { ...previous, data: { ...previous.data, art: applyLocally(previous.data.art, operation) } });
      return { previous };
    },
    onError: (error, _operation, context) => {
      if (context?.previous) client.setQueryData(recordKey(collection, id!), context.previous);
      // Someone else reviewed this record meanwhile: reload it so the next verdict names the current revision.
      if (isMetaConflict(error)) void client.invalidateQueries({ queryKey: recordKey(collection, id!) });
      toast.error(error instanceof Error ? error.message : String(error));
    },
    onSuccess: response => { client.setQueryData(recordKey(collection, id!), response); },
    onSettled: () => { void client.invalidateQueries({ queryKey: digestKey(collection) }); },
  });
  const art = query.data?.data.art;
  return {
    art,
    /** The whole metadata record (status, notes, per-body approvals), for read-only context. */
    record: query.data?.data,
    /** The verdict on the record, or on one aspect when `key` is given. */
    verdict: (key?: string): ArtVerdict | undefined => key ? art?.checks?.[key]?.verdict : art?.verdict,
    note: (key?: string): string | undefined => key ? art?.checks?.[key]?.note : art?.note,
    review: (operation: ArtReviewOperation) => mutation.mutate(operation),
    isPending: query.isPending && canReviewArt() && Boolean(id),
    isSaving: mutation.isPending,
  };
}

function applyLocally(art: ArtRecord | undefined, operation: ArtReviewOperation): ArtRecord {
  const next: ArtRecord = { ...art, checks: { ...art?.checks } };
  const target = operation.key === undefined ? next : (next.checks![operation.key] = { ...next.checks![operation.key] });
  if (operation.verdict === "clear") delete target.verdict;
  else if (operation.verdict) target.verdict = operation.verdict;
  if (operation.note !== undefined) target.note = operation.note.trim() ? operation.note : undefined;
  return next;
}
