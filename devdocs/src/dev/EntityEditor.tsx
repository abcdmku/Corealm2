import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useController, useForm } from "react-hook-form";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronDown, LockKeyhole, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { CONTENT_COLLECTIONS, type ContentCollection } from "../../../tools/content/collections.js";
import { ArraySchema, DiscriminatedSchema, ObjectSchema, RecordSchema, TupleSchema, UnionSchema, type Schema, type SchemaIssue } from "../../../game/src/content/schema/core.js";
import { collectionQuery } from "../api/client.js";
import type { CollectionResponse } from "../../shared/contracts.js";
import type { AppProps } from "../model/contracts.js";
import { containsIdentity, defaultFieldValue, fieldCore, fieldIssues, fieldTitle, serialFieldSpec, unionVariant } from "../model/fields.js";
import { summaryContext, useReferenceIndex } from "../model/refs.js";
import { EditorContext, RefField, refKindFor, visualEditorFor, VisualEditorFrame } from "./editors.js";
import "./editor.css";

type Draft = { record: unknown };
type Change = (value: unknown) => void;
const balanceCollections = CONTENT_COLLECTIONS.filter(collection => collection.name.startsWith("balance/")).map(collection => collection.name);
const badKeys = new Set(["__proto__", "prototype", "constructor"]);
const ADVANCED_FIELDS = new Set(["catalog", "source", "sourceInputId", "legacyOverride", "derived", "registrationOrder", "labOrder", "fantasyTierOrder", "lineage", "history", "provenance", "migration"]);
const elementId = (path: string) => `edit-${encodeURIComponent(path || "record")}`;
const childPath = (path: string, key: string | number) => typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key;
const asObject = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function editableRecord(response: CollectionResponse, spec: ContentCollection, id: string): unknown {
  return spec.shape === "object" ? response.data : (response.data as Record<string, unknown>[]).find(record => String(record[spec.idKey]) === id);
}
function diagnosticPath(path: string, collection: string): string {
  let result = path.startsWith(collection) ? path.slice(collection.length).replace(/^\[[^\]]*\]/, "") : path;
  result = result.replace(/^record\.?/, "").replace(/^\./, "");
  return result;
}

export default function EntityEditor({ collection, recordId, navigate }: { collection: string; recordId: string; navigate?: AppProps["navigate"] }) {
  const query = useQuery(collectionQuery(collection));
  const { index } = useReferenceIndex();
  const ctx = useMemo(() => summaryContext(index), [index]);
  const environment = useMemo(() => ({ collection, ctx, index, navigate }), [collection, ctx, index, navigate]);
  const spec = CONTENT_COLLECTIONS.find(candidate => candidate.name === collection);
  if (!spec) return <p className="editor-message">This collection has no editable schema.</p>;
  if (query.isPending) return <p className="editor-message" role="status">Loading fields…</p>;
  if (query.isError) return <p className="editor-message" role="alert">{query.error.message} <button className="button button-small" onClick={() => void query.refetch()}>Retry</button></p>;
  if (editableRecord(query.data, spec, recordId) === undefined) return <p className="editor-message" role="alert">This record no longer exists. Your other content has not changed.</p>;
  return <EditorContext.Provider value={environment}><DraftEditor key={`${collection}:${recordId}`} spec={spec} recordId={recordId} initial={query.data} /></EditorContext.Provider>;
}

function DraftEditor({ spec, recordId, initial }: { spec: ContentCollection; recordId: string; initial: CollectionResponse }) {
  const queryClient = useQueryClient();
  const [revision, setRevision] = useState(initial.revision);
  const [serverIssues, setServerIssues] = useState<SchemaIssue[]>([]);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [resetting, setResetting] = useState(false);
  const transitionRef = useRef(false);
  const ownMutationRef = useRef<{ base: string; target: string } | undefined>(undefined);
  const form = useForm<Draft>({ mode: "onChange", defaultValues: { record: structuredClone(editableRecord(initial, spec, recordId)) } });
  const controller = useController({ name: "record", control: form.control, rules: { validate: value => fieldIssues(spec.schema, value).every(issue => issue.severity !== "error") || "Check the highlighted fields." } });
  const value = controller.field.value;
  const formulaLinked = asObject(value).derivation !== undefined;
  const balances = useQueries({ queries: balanceCollections.map(collection => ({ ...collectionQuery(collection), enabled: formulaLinked })) });
  const formula = useMemo(() => {
    if (!formulaLinked) return { keys: [] as string[], blocked: false, message: "" };
    const protectAll = Object.keys(asObject(value)).filter(key => key !== "derivation");
    if (balances.some(query => query.isPending)) return { keys: protectAll, blocked: true, message: "Loading formula parameters; fields stay locked until the formula is checked." };
    if (balances.some(query => query.isError)) return { keys: protectAll, blocked: true, message: "Formula parameters could not be loaded; fields stay locked and saving is paused." };
    return { keys: protectAll, blocked: false, message: "Formula-controlled fields are locked. Remove the formula link to hand tune them." };
  }, [formulaLinked, value, balances]);
  const clientIssues = useMemo(() => fieldIssues(spec.schema, value), [spec.schema, value]);
  const issues = [...clientIssues, ...serverIssues];
  const invalid = clientIssues.some(issue => issue.severity === "error");
  const busy = form.formState.isSubmitting || resetting;
  const dirty = form.formState.isDirty;
  const focusSection = spec.shape === "object" && recordId !== "$collection" ? recordId : undefined;
  useEffect(() => {
    const ownMutation = ownMutationRef.current;
    if (initial.revision === revision) {
      if (ownMutation?.target === initial.revision) ownMutationRef.current = undefined;
      return;
    }
    if (ownMutation) {
      if (initial.revision === ownMutation.base) return;
      ownMutationRef.current = undefined;
    }
    if (transitionRef.current || busy || conflict || dirty) return;
    const fresh = editableRecord(initial, spec, recordId);
    if (fresh === undefined) return;
    form.reset({ record: structuredClone(fresh) });
    setRevision(initial.revision);
    setSaveError(""); setServerIssues([]);
  }, [busy, conflict, dirty, form, initial, recordId, revision, spec]);
  function change(next: unknown) { controller.field.onChange(next); setServerIssues([]); if (!conflict) setSaveError(""); }
  async function save(draft: Draft) {
    if (conflict || formula.blocked || transitionRef.current) return;
    const baseRevision = revision;
    transitionRef.current = true;
    setSaveError(""); setServerIssues([]);
    try {
      const target = spec.shape === "object" ? "$collection" : recordId;
      const response = await fetch(`/__devdocs/collections/${encodeURIComponent(spec.name)}/${encodeURIComponent(target)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision, record: draft.record }) });
      const body = await response.json() as CollectionResponse & { error?: string; diagnostics?: SchemaIssue[] };
      if (!response.ok) {
        setServerIssues((body.diagnostics ?? []).map(issue => ({ ...issue, path: diagnosticPath(issue.path, spec.name) })));
        setConflict(response.status === 409);
        setSaveError(response.status === 409 ? "This file changed after you opened it. Your draft is still here. Reset the draft to load the current file before saving again." : body.error ?? `Save failed (${response.status}). Your draft is still here.`);
        return;
      }
      if (!body.collection || typeof body.revision !== "string") throw new Error("The server returned an incomplete save response. Your draft has been kept; reload the file before retrying.");
      const saved = editableRecord(body, spec, recordId);
      ownMutationRef.current = { base: baseRevision, target: body.revision };
      queryClient.setQueryData(collectionQuery(spec.name).queryKey, body);
      setRevision(body.revision);
      form.reset({ record: structuredClone(saved) });
      setServerIssues((body.diagnostics ?? []).map(issue => ({ ...issue, path: diagnosticPath(issue.path, spec.name) })));
      toast.success("Saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The save could not be completed. Your draft is still here.");
    } finally {
      transitionRef.current = false;
    }
  }
  async function resetDraft() {
    if (transitionRef.current) return;
    const baseRevision = revision;
    transitionRef.current = true;
    setResetting(true);
    try {
      const response = await queryClient.fetchQuery({ ...collectionQuery(spec.name), staleTime: 0 });
      const fresh = editableRecord(response, spec, recordId);
      if (fresh === undefined) throw new Error("The record no longer exists. The draft has been kept.");
      ownMutationRef.current = { base: baseRevision, target: response.revision };
      form.reset({ record: structuredClone(fresh) }); setRevision(response.revision); setSaveError(""); setServerIssues([]); setConflict(false);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Could not reload the file. The draft has been kept."); }
    finally { transitionRef.current = false; setResetting(false); }
  }
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void form.handleSubmit(save)(); }
    }
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  });
  return <form className="entity-editor" onSubmit={form.handleSubmit(save)} noValidate>
    <div className="editor-toolbar">
      <span className="editor-dirty" role="status">{form.formState.isDirty ? <span className="badge" data-tone="warn">Unsaved changes</span> : <><Check size={13} /> Saved</>}</span>
      {formulaLinked && <span className="editor-formula-notice" role="status"><LockKeyhole size={13} /><p>{formula.message}</p>{formula.blocked && <button type="button" className="editor-small-button" onClick={() => balances.forEach(query => void query.refetch())}>Retry</button>}</span>}
      <div className="editor-actions">
        <button type="button" className="button button-small" aria-label="Reset draft" disabled={busy || (!form.formState.isDirty && !conflict)} onClick={() => void resetDraft()}><RotateCcw size={13} />{resetting ? "Reloading…" : "Reset"}</button>
        <button type="submit" className="button button-small editor-save" aria-label="Save changes" disabled={busy || !form.formState.isDirty || invalid || conflict || formula.blocked} title="Save changes (Ctrl+S)"><Save size={13} />{form.formState.isSubmitting ? "Saving…" : "Save"}</button>
      </div>
    </div>
    {saveError && <div className="editor-error-summary" role="alert"><AlertCircle size={15} /><p>{saveError}</p></div>}
    {issues.length > 0 && <div className="editor-diagnostics" aria-label="Validation diagnostics"><h3>{issues.filter(issue => issue.severity === "error").length ? "Fix these fields" : "Notes"}</h3><ul>{issues.map((issue, index) => <li key={`${issue.path}:${index}`}><button type="button" onClick={() => { const target = document.getElementById(elementId(issue.path)); target?.scrollIntoView({ block: "center", behavior: "instant" }); target?.querySelector<HTMLElement>("input,select,textarea,button")?.focus(); }}><span>{issue.path || "Record"}</span> {issue.message}</button></li>)}</ul></div>}
    <fieldset disabled={busy} className="editor-fields"><FieldNode schema={spec.schema} value={value} onChange={change} name="record" path="" issues={issues} root idKey={spec.shape === "array" ? spec.idKey : undefined} focusSection={focusSection} lockedKeys={formula.keys} /></fieldset>
  </form>;
}

interface FieldNodeProps { schema: Schema; value: unknown; onChange: Change; name: string; path: string; issues: SchemaIssue[]; locked?: boolean; root?: boolean; idKey?: string; focusSection?: string; lockedKeys?: string[]; lockedReason?: string; embedded?: boolean }

/**
 * One schema field. Primitives render as a label + control row inside the sheet grid; objects,
 * arrays, keyed records and visual editors become collapsible full-width sections.
 */
function FieldNode({ schema, value, onChange, name, path, issues, locked = false, root = false, idKey, focusSection, lockedKeys, lockedReason, embedded = false }: FieldNodeProps) {
  const spec = serialFieldSpec(schema, name);
  const node = fieldCore(schema);
  const [showFields, setShowFields] = useState(false);
  const editorCollection = useContext(EditorContext).collection;
  const Visual = path && !showFields ? visualEditorFor(editorCollection, path) : undefined;
  if (spec.hidden || ADVANCED_FIELDS.has(name)) return null;
  const formulaTag = path === "derivation";
  const readOnly = locked || formulaTag || Boolean(spec.readOnly || spec.identity);
  const ownIssues = issues.filter(issue => issue.path === path);
  const hasError = ownIssues.some(issue => issue.severity === "error");
  const branchError = issues.some(issue => issue.severity === "error" && issue.path.startsWith(path) && path !== "");
  const errorId = `${elementId(path)}-error`;
  const fieldProps = { "aria-label": spec.label, "aria-describedby": ownIssues.length ? errorId : undefined, "aria-invalid": hasError || undefined };
  const replaceKey = (key: string, next: unknown) => { const copy = { ...asObject(value) }; if (next === undefined) delete copy[key]; else Object.defineProperty(copy, key, { value: next, enumerable: true, writable: true, configurable: true }); onChange(copy); };
  const refKind = node.kind === "string" ? refKindFor(spec, name) : undefined;
  const unset = (value === undefined && spec.optional) || (value === null && spec.nullable);
  const structural = node instanceof ObjectSchema || node instanceof ArraySchema || node instanceof TupleSchema || node instanceof RecordSchema || ((node instanceof UnionSchema || node instanceof DiscriminatedSchema) && !spec.choices);
  const wide = !unset && !readOnly && (Boolean(Visual) || spec.multiline === true || structural);
  const constraints = [spec.help, spec.min !== undefined && `min ${spec.min}`, spec.max !== undefined && `max ${spec.max}`, spec.exclusiveMin !== undefined && `> ${spec.exclusiveMin}`, spec.exclusiveMax !== undefined && `< ${spec.exclusiveMax}`, spec.integer && "integer", spec.optional && "optional", ...spec.refinements].filter(Boolean).join(" · ");
  let content: ReactNode;
  let heading: ReactNode = null;
  let count: number | undefined;
  if (value === undefined && spec.optional) content = <div className="editor-unset"><span>Not set</span>{!readOnly && <button type="button" className="editor-small-button" onClick={() => onChange(defaultFieldValue(node))}><Plus size={12} />Add</button>}</div>;
  else if (value === null && spec.nullable) content = <div className="editor-unset"><span>No value</span>{!readOnly && <button type="button" className="editor-small-button" onClick={() => onChange(defaultFieldValue(node))}>Set value</button>}</div>;
  else if (readOnly) content = <div className="editor-locked">{refKind && typeof value === "string" ? <RefField kind={refKind} value={value} onChange={onChange} readOnly name={spec.label} /> : <ReadValue value={value} />}<span><LockKeyhole size={11} /> {lockedReason ?? (formulaTag ? "Formula link" : spec.identity || name === "count" || name === "legacyCount" ? "Save identity" : "Read only")}</span></div>;
  else if (Visual) content = <VisualEditorFrame label={spec.label} onShowFields={() => setShowFields(true)}><Visual path={path} value={value} onChange={onChange} issues={issues} schema={schema} /></VisualEditorFrame>;
  else if (spec.choices) content = spec.kind === "literal" ? <span className="editor-literal">{String(value)}</span> : <select {...fieldProps} value={String(spec.choices.findIndex(choice => choice === value))} onChange={event => onChange(spec.choices![Number(event.target.value)])}>{!spec.choices.includes(value as string) && <option value="-1">Choose…</option>}{spec.choices.map((choice, index) => <option key={index} value={index}>{String(choice)}</option>)}</select>;
  else if (node.kind === "boolean") content = <label className="editor-checkbox"><input {...fieldProps} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} />{value ? "Yes" : "No"}</label>;
  else if (node.kind === "number") content = <div className="editor-number"><input {...fieldProps} type="number" value={typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" ? value : ""} min={spec.min} max={spec.max} step={spec.step ?? "any"} onChange={event => onChange(event.target.value === "" ? "" : event.target.valueAsNumber)} />{spec.unit && <span>{spec.unit}</span>}</div>;
  else if (node.kind === "string") content = spec.multiline ? <textarea {...fieldProps} value={typeof value === "string" ? value : ""} minLength={spec.minLength} maxLength={spec.maxLength} rows={3} onChange={event => onChange(event.target.value)} /> : refKind ? <RefField kind={refKind} value={value} onChange={onChange} fieldProps={fieldProps} name={spec.label} /> : <input {...fieldProps} value={typeof value === "string" ? value : ""} type="text" minLength={spec.minLength} maxLength={spec.maxLength} pattern={spec.pattern} onChange={event => onChange(event.target.value)} />;
  else if (node instanceof ObjectSchema) {
    const entries = Object.entries(node.fields) as [string, Schema][];
    if (focusSection) entries.sort(([a], [b]) => a === focusSection ? -1 : b === focusSection ? 1 : 0);
    const current = asObject(value);
    // Optional fields that are not set collapse into one "add" row so a sheet shows what the
    // record actually says instead of a column of "Not set".
    const absent = entries.filter(([key, field]) => current[key] === undefined && serialFieldSpec(field, key).optional && !ADVANCED_FIELDS.has(key) && !serialFieldSpec(field, key).hidden);
    const shown = absent.length >= 3 ? entries.filter(([key]) => !absent.some(([absentKey]) => absentKey === key)) : entries;
    count = shown.length;
    content = <div className={root ? "sheet" : "sheet-grid"}>
      {shown.map(([key, field]) => <FieldNode key={key} schema={field} value={current[key]} onChange={next => replaceKey(key, next)} name={key} path={childPath(path, key)} issues={issues} locked={root && (key === idKey || lockedKeys?.includes(key))} lockedReason={root && lockedKeys?.includes(key) ? "Controlled by formula" : undefined} />)}
      {Object.keys(current).filter(key => !Object.hasOwn(node.fields, key) && !ADVANCED_FIELDS.has(key)).map(key => <div className="editor-preserved" key={key}><strong>{fieldTitle(key)}</strong><ReadValue value={current[key]} /><small>Unrecognized field, kept as is.</small></div>)}
      {absent.length >= 3 && !readOnly && <div className="sheet-add-row"><span className="sheet-label">Add</span><div className="chip-row">{absent.map(([key, field]) => <button type="button" key={key} className="filter-chip" onClick={() => replaceKey(key, defaultFieldValue(fieldCore(field)))} title={serialFieldSpec(field, key).help}><Plus size={11} />{serialFieldSpec(field, key).label}</button>)}</div></div>}
    </div>;
  } else if (node instanceof ArraySchema || node instanceof TupleSchema) {
    const entries = Array.isArray(value) ? value : [];
    const fixed = node instanceof TupleSchema;
    const identity = !fixed && containsIdentity(node.item);
    count = entries.length;
    const primitiveItems = entries.length > 0 && entries.every(entry => typeof entry !== "object" || entry === null);
    content = <div className="editor-array">
      {primitiveItems
        ? <div className="sheet-grid">{entries.map((entry, index) => { const entrySchema = node instanceof TupleSchema ? node.items[index] : node.item; return entrySchema ? <FieldNode key={index} schema={entrySchema} value={entry} onChange={next => onChange(entries.map((existing, i) => i === index ? next : existing))} name={`${index + 1}`} path={childPath(path, index)} issues={issues} /> : <ReadValue value={entry} key={index} />; })}</div>
        : entries.map((entry, index) => { const entrySchema = node instanceof TupleSchema ? node.items[index] : node.item; if (!entrySchema) return <ReadValue value={entry} key={index} />; return <div className="editor-array-entry" key={index}><div className="editor-array-heading"><span>{index + 1}{typeof asObject(entry).name === "string" ? ` · ${asObject(entry).name}` : ""}</span>{!fixed && !identity && <button type="button" className="icon-button" aria-label={`Remove ${spec.label.toLowerCase()} entry ${index + 1}`} disabled={entries.length <= (spec.minLength ?? 0)} onClick={() => onChange(entries.filter((_, i) => index !== i))}><X size={12} /></button>}</div><FieldNode schema={entrySchema} value={entry} onChange={next => onChange(entries.map((existing, i) => i === index ? next : existing))} name={`Entry ${index + 1}`} path={childPath(path, index)} issues={issues} root /></div>; })}
      {!entries.length && <span className="editor-empty">No entries.</span>}
      {!fixed && !identity && <button type="button" className="editor-small-button" disabled={spec.maxLength !== undefined && entries.length >= spec.maxLength} onClick={() => onChange([...entries, defaultFieldValue(node.item)])}><Plus size={12} />Add entry</button>}
      {identity && <span className="editor-empty">Entry order and membership are fixed (save identity).</span>}
    </div>;
  } else if (node instanceof RecordSchema) { count = Object.keys(asObject(value)).length; content = <RecordFields schema={node} value={asObject(value)} path={path} issues={issues} onChange={onChange} />; }
  else if (node instanceof UnionSchema || node instanceof DiscriminatedSchema) {
    const selected = unionVariant(node, value);
    const member = node instanceof DiscriminatedSchema ? node.members[selected] : node.members[Number(selected)];
    heading = <label className="editor-union-choice" onClick={event => event.stopPropagation()}><span>{spec.discriminator ? fieldTitle(spec.discriminator) : "Type"}</span><select aria-label={`${spec.label} ${spec.discriminator ?? "value type"}`} value={selected} disabled={containsIdentity(node)} onChange={event => { const next = node instanceof DiscriminatedSchema ? node.members[event.target.value] : node.members[Number(event.target.value)]; if (next) onChange(defaultFieldValue(next)); }}>{spec.variants?.map(variant => <option key={variant.key} value={variant.key}>{variant.label}</option>)}</select></label>;
    content = member ? <FieldNode schema={member} value={value} onChange={onChange} name={name} path={path} issues={issues} root embedded /> : null;
  } else content = <div className="editor-preserved"><ReadValue value={value} /><small>Kept as is; no typed editor.</small></div>;

  const actions = <span className="sheet-field-actions">
    {(!readOnly || formulaTag) && value !== undefined && spec.optional && <button type="button" className="icon-button" title={name === "derivation" ? "Remove formula link" : "Remove"} aria-label={`Remove ${spec.label}`} onClick={() => onChange(undefined)}><Trash2 size={12} /></button>}
    {!readOnly && value !== null && value !== undefined && spec.nullable && <button type="button" className="editor-small-button" onClick={() => onChange(null)}>Set to none</button>}
  </span>;
  const errors = ownIssues.length > 0 ? <ul id={errorId} className="editor-field-errors">{ownIssues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul> : null;

  if (root) return <div id={embedded ? undefined : elementId(path)} className={`sheet-root${hasError ? " has-error" : ""}`}>{content}{errors}</div>;
  if (wide) {
    return <details id={elementId(path)} className={`sheet-section${hasError || branchError ? " has-error" : ""}`} open>
      <summary title={constraints || undefined}><ChevronDown size={13} /><span>{spec.label}</span>{count !== undefined && <small>{count}</small>}{heading}{actions}</summary>
      <div className="sheet-section-body">{content}</div>
      {errors}
    </details>;
  }
  return <div id={elementId(path)} className={`sheet-field${hasError ? " has-error" : ""}`}>
    <span className="sheet-label" title={constraints || undefined} data-optional={spec.optional || undefined}>{spec.label}</span>
    <div className="sheet-control">{content}{actions}</div>
    {errors}
  </div>;
}

function RecordFields({ schema, value, path, issues, onChange }: { schema: RecordSchema<string, unknown>; value: Record<string, unknown>; path: string; issues: SchemaIssue[]; onChange: Change }) {
  const [key, setKey] = useState("");
  const keyIssues = schema.key && key ? fieldIssues(schema.key, key) : [];
  const identity = containsIdentity(schema.value);
  const validKey = Boolean(key && !Object.hasOwn(value, key) && !badKeys.has(key) && !keyIssues.length);
  return <div className="editor-record">
    <div className="sheet-grid">{Object.entries(value).filter(([entryKey]) => !ADVANCED_FIELDS.has(entryKey)).map(([entryKey, entry]) => <div className="editor-record-entry" key={entryKey}><FieldNode schema={schema.value} value={entry} onChange={next => onChange({ ...value, [entryKey]: next })} name={entryKey} path={childPath(path, entryKey)} issues={issues} />{!identity && <button type="button" className="icon-button" aria-label={`Remove ${entryKey}`} title={`Remove ${entryKey}`} onClick={() => { const next = { ...value }; delete next[entryKey]; onChange(next); }}><X size={12} /></button>}</div>)}</div>
    {!identity && <div className="editor-record-add"><label>New key<input aria-label={`New key for ${path || "record"}`} value={key} onChange={event => setKey(event.target.value)} placeholder="key" /></label><button type="button" className="editor-small-button" disabled={!validKey} onClick={() => { if (validKey) { onChange({ ...value, [key]: defaultFieldValue(schema.value) }); setKey(""); } }}><Plus size={12} />Add</button>{key && !validKey && <span className="editor-empty">{Object.hasOwn(value, key) ? "Key exists." : keyIssues[0]?.message ?? "Choose a different key."}</span>}</div>}
  </div>;
}

function ReadValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="editor-empty">{value === null ? "No value" : "Not set"}</span>;
  if (typeof value !== "object") return <span className="editor-read-value">{String(value)}</span>;
  if (Array.isArray(value)) return <ul className="editor-read-list">{value.map((entry, index) => <li key={index}><ReadValue value={entry} /></li>)}</ul>;
  return <dl className="editor-read-object">{Object.entries(value).map(([key, entry]) => <div key={key}><dt>{fieldTitle(key)}</dt><dd><ReadValue value={entry} /></dd></div>)}</dl>;
}
