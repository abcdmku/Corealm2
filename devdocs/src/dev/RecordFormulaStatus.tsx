import { useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, LockKeyhole, RefreshCw, Sigma } from "lucide-react";
import { toast } from "sonner";
import { CONTENT_COLLECTIONS } from "../../../tools/content/collections.js";
import { deriveRecord, sameValue, type DerivationDiff } from "../../../game/src/content/balance/derivations.js";
import type { CollectionResponse } from "../../shared/contracts.js";
import { collectionQuery } from "../api/client.js";
import "./recordFormula.css";

type Row = Record<string, unknown>;
type Props = { collection: string; recordId: string };
type Preview = { diffs: DerivationDiff[]; revisions: Record<string, string> };
type Failure = { error?: string; diagnostics?: { path: string; message: string }[] };
type KeepDraft = { record: Row; revision: string };
const balanceNames = CONTENT_COLLECTIONS.filter(spec => spec.name.startsWith("balance/")).map(spec => spec.name);
const object = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const recordIn = (response: CollectionResponse | undefined, id: string): Row | undefined => response?.collection.shape === "array" && Array.isArray(response.data)
  ? response.data.find((row: unknown): row is Row => object(row) && String(row[response.collection.idKey]) === id) : undefined;
const failureMessage = (body: Failure, fallback: string) => [body.error ?? fallback, ...(body.diagnostics ?? []).map(issue => `${issue.path}: ${issue.message}`)].join(" ");

/** Loaded only by the development detail view. Navigation resets all review state. */
export default function RecordFormulaStatus(props: Props) {
  return <FormulaStatus key={`${props.collection}:${props.recordId}`} {...props}/>;
}

function FormulaStatus({ collection, recordId }: Props) {
  const queryClient = useQueryClient();
  const records = useQuery(collectionQuery(collection));
  const record = recordIn(records.data, recordId);
  const linked = record?.derivation !== undefined;
  const balances = useQueries({ queries: balanceNames.map(name => ({ ...collectionQuery(name), enabled: linked })) });
  const [preview, setPreview] = useState<Preview>();
  const [keepDraft, setKeepDraft] = useState<KeepDraft>();
  const [busy, setBusy] = useState<"preview" | "apply" | "keep" | "refresh">();
  const inFlight = useRef(false);
  const [conflict, setConflict] = useState(false);
  const [invalidPreview, setInvalidPreview] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const formula = useMemo(() => {
    if (!linked || !record) return { status: "unlinked" as const };
    if (balances.some(query => query.isError)) return { status: "error" as const, message: "Formula parameters could not be loaded. Refresh the record to retry." };
    if (balances.some(query => query.isPending)) return { status: "loading" as const };
    try {
      const tables = new Map(balances.flatMap(query => query.data ? [[query.data.collection.name, query.data.data] as const] : []));
      tables.set(collection, records.data!.data);
      const after = deriveRecord(collection, record, tables);
      if (!after) throw new Error("This formula link could not be calculated.");
      const before = Object.fromEntries(Object.keys(after).map(key => [key, record[key]]));
      return { status: sameValue(before, after) ? "aligned" as const : "drift" as const };
    } catch (failure) {
      return { status: "error" as const, message: failure instanceof Error ? failure.message : "The formula could not be calculated." };
    }
  }, [linked, record, balances, collection, records.data]);
  const knownSnapshots = [records.data, ...balances.map(query => query.data)];
  const revisionsChanged = Boolean(preview && knownSnapshots.some(snapshot => snapshot && preview.revisions[snapshot.collection.name] !== snapshot.revision));
  const stale = invalidPreview || conflict || revisionsChanged || records.isError || balances.some(query => query.isError);
  const diffs = preview?.diffs ?? [];

  async function refreshSnapshots() {
    const fresh = await queryClient.fetchQuery({ ...collectionQuery(collection), staleTime: 0 });
    if (!recordIn(fresh, recordId)) throw new Error("This record no longer exists. The previous review has been kept.");
    if (recordIn(fresh, recordId)?.derivation !== undefined) {
      await Promise.all(balanceNames.map(name => queryClient.fetchQuery({ ...collectionQuery(name), staleTime: 0 })));
    }
    return fresh;
  }

  async function request(operation: "preview" | "apply" | "keep" | "refresh") {
    if (inFlight.current) return;
    if (operation === "apply" && (!preview || stale || !diffs.length || formula.status !== "drift")) return;
    if (operation === "keep" && (!linked || !record || !records.data || conflict || keepDraft)) return;
    inFlight.current = true;
    setBusy(operation); setError(""); setNotice("");
    try {
      if (operation === "refresh") {
        await refreshSnapshots();
        setConflict(false); setKeepDraft(undefined); setInvalidPreview(true);
        setNotice("Record refreshed. Request a new preview before applying formula values.");
        return;
      }
      if (operation === "keep") {
        // Keep the exact raw record and revision being reviewed, including unknown authored fields.
        const draft = { record: structuredClone(record!), revision: records.data!.revision };
        delete draft.record.derivation;
        setKeepDraft(draft);
        const response = await fetch(`/__devdocs/collections/${encodeURIComponent(collection)}/${encodeURIComponent(recordId)}`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft),
        });
        const body = await response.json() as CollectionResponse & Failure;
        if (!response.ok) {
          setConflict(response.status === 409); setInvalidPreview(true);
          throw new Error(response.status === 409 ? "This record's file changed. Your keep-values draft and preview are still here. Refresh the record before trying again." : failureMessage(body, "The formula link could not be removed. Your draft has been kept. Refresh the record before trying again."));
        }
        if (body.collection?.name !== collection || typeof body.revision !== "string" || !recordIn(body, recordId)) throw new Error("The save response was incomplete. Your draft has been kept. Refresh the record to check the saved values.");
        queryClient.setQueryData(collectionQuery(collection).queryKey, body);
        setKeepDraft(undefined); setPreview(undefined); setInvalidPreview(false);
        setNotice("Values kept. This record is now hand tuned.");
        toast.success("Values kept; formula link removed");
        return;
      }
      if (operation === "preview") await refreshSnapshots();
      const response = await fetch("/__devdocs/recompute", {
        method: "POST", headers: { "content-type": "application/json" },
        // The server calculates its own patch. Only selection and reviewed revisions are sent.
        body: JSON.stringify({ operation, collection, recordId, ...(operation === "apply" ? { revisions: preview!.revisions } : {}) }),
      });
      const body = await response.json() as Preview & Failure;
      if (!response.ok) {
        setConflict(response.status === 409); setInvalidPreview(true);
        throw new Error(response.status === 409 ? "Content changed after this preview. The preview is kept for comparison. Refresh it before applying changes." : failureMessage(body, "The formula request failed. Your preview has been kept."));
      }
      if (!Array.isArray(body.diffs) || !object(body.revisions) || CONTENT_COLLECTIONS.some(spec => typeof body.revisions[spec.name] !== "string")
        || body.diffs.some(diff => diff.collection !== collection || diff.recordId !== recordId || !object(diff.before) || !object(diff.after))) {
        throw new Error("The server returned an incomplete record preview. Refresh before applying changes.");
      }
      if (operation === "preview") {
        setPreview(body); setInvalidPreview(false); setConflict(false); setKeepDraft(undefined);
      } else {
        setInvalidPreview(true);
        await queryClient.invalidateQueries({ queryKey: collectionQuery(collection).queryKey });
        setNotice("Formula values applied. Refresh the preview to check the saved record.");
        toast.success("Formula values applied");
      }
    } catch (failure) {
      setInvalidPreview(true);
      setError(failure instanceof Error ? failure.message : "The request failed. Your review has been kept. Refresh before trying again.");
    } finally {
      inFlight.current = false; setBusy(undefined);
    }
  }

  if (records.isPending) return <section className="record-formula" role="status">Loading formula status...</section>;
  if (records.isError && !records.data) return <section className="record-formula"><p role="alert">{records.error.message}</p><button className="button" type="button" onClick={() => void records.refetch()}>Retry</button></section>;
  if (!record && !preview && !keepDraft) return null;
  if (!linked && !preview && !keepDraft && !notice) return null;
  const label = !record ? "Record unavailable" : formula.status === "aligned" ? "Formula-aligned" : formula.status === "drift" ? "Formula drift" : formula.status === "error" ? "Formula error" : formula.status === "loading" ? "Checking formula..." : "Hand tuned";
  return <section className="record-formula" aria-label="Record formula status">
    <div className="record-formula-heading"><Sigma size={18}/><div><h2>{label}</h2><p>{formula.status === "aligned" ? "Saved values match the current formula parameters." : formula.status === "drift" ? "Saved values differ from the current formula. Review the changes, or keep these values and remove the formula link." : formula.status === "unlinked" ? "This record has no formula link." : "Formula status uses the saved record and parameters."}</p></div></div>
    {formula.status === "error" && <p className="record-formula-error" role="alert"><AlertCircle size={15}/>{formula.message}</p>}
    {records.isError && <p className="record-formula-error" role="alert">The record could not be refreshed. The previous review is still here. {records.error.message}</p>}
    {linked && <p className="record-formula-note"><LockKeyhole size={13}/>Formula-controlled fields remain read only while linked. These actions use saved values.</p>}
    {error && <p className="record-formula-error" role="alert">{error}</p>}
    {notice && <p className="record-formula-notice" role="status"><Check size={14}/>{notice}</p>}
    <div className="record-formula-actions">
      {linked && <button className="button" type="button" disabled={Boolean(busy)} onClick={() => void request("preview")}><RefreshCw size={14}/>{busy === "preview" ? "Calculating..." : preview ? "Refresh preview" : "Preview formula changes"}</button>}
      {linked && <button className="button" type="button" disabled={Boolean(busy) || conflict || Boolean(keepDraft)} onClick={() => void request("keep")}>{busy === "keep" ? "Keeping values..." : "Keep these values"}</button>}
      {(error || conflict || keepDraft || records.isError || formula.status === "error" || !record) && <button className="button" type="button" disabled={Boolean(busy)} onClick={() => void request("refresh")}>{busy === "refresh" ? "Refreshing..." : "Refresh record"}</button>}
    </div>
    {keepDraft && <p className="record-formula-note">The keep-values draft is preserved. Refreshing loads the current saved record before another attempt.</p>}
    {preview && <div className="record-formula-preview">
      <h3>Reviewed formula changes</h3>
      {stale && <p className="record-formula-note" role="status">This preview needs a refresh before it can be applied. The previous values remain below for comparison.</p>}
      {!diffs.length ? <p className="record-formula-note">No differences in this preview.</p> : <><div className="record-formula-scroll"><table><thead><tr><th scope="col">Field</th><th scope="col">Saved value</th><th scope="col">Formula value</th></tr></thead><tbody>{diffs.flatMap(diff => Object.keys({ ...diff.before, ...diff.after }).filter(key => !sameValue(diff.before[key], diff.after[key])).map(key => <tr key={`${diff.recordId}:${key}`}><th scope="row">{key}</th><td><Value value={diff.before[key]}/></td><td><Value value={diff.after[key]}/></td></tr>))}</tbody></table></div><div className="record-formula-apply"><p>Apply changes to this record. Authored fields outside the formula stay unchanged.</p><button className="button" type="button" disabled={Boolean(busy) || stale || formula.status !== "drift"} onClick={() => void request("apply")}>{busy === "apply" ? "Applying..." : "Apply formula values"}</button></div></>}
    </div>}
  </section>;
}

function Value({ value }: { value: unknown }) {
  if (value === undefined) return <span className="record-formula-absent">Not present</span>;
  return <pre>{typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}</pre>;
}
