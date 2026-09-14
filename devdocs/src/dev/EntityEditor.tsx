import { useMemo, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, LockKeyhole, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CONTENT_COLLECTIONS, type ContentCollection } from "../../../tools/content/collections.js";
import { ArraySchema, DiscriminatedSchema, ObjectSchema, RecordSchema, TupleSchema, UnionSchema, type Schema, type SchemaIssue } from "../../../game/src/content/schema/core.js";
import { deriveRecord } from "../../../game/src/content/balance/derivations.js";
import { collectionQuery, collectionsQuery } from "../api/client.js";
import type { CollectionResponse } from "../../shared/contracts.js";
import { contentRows, rowId, rowName } from "../model/rows.js";
import { containsIdentity, defaultFieldValue, fieldCore, fieldIssues, fieldTitle, serialFieldSpec, unionVariant, type SerialFieldSpec } from "../model/fields.js";
import "./editor.css";

type Draft = { record: unknown };
type Change = (value: unknown) => void;
const refs: Record<string, string> = { item: "items", recipe: "recipes", resource: "resources", npc: "npcs", shop: "shops", quest: "quests", dialogue: "dialogue", spell: "spells", rune: "spellRunes", set: "equipmentSets", enemy: "enemies", species: "creatures", resourceCluster: "resourceClusters", lootTable: "lootTables", campfireFuel: "campfireFuels", asset: "assets" };
const balanceCollections = CONTENT_COLLECTIONS.filter(collection => collection.name.startsWith("balance/") || collection.name === "craftingTiers");
const badKeys = new Set(["__proto__", "prototype", "constructor"]);
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

export default function EntityEditor({ collection, recordId }: { collection: string; recordId: string }) {
  const query = useQuery(collectionQuery(collection));
  const spec = CONTENT_COLLECTIONS.find(candidate => candidate.name === collection);
  if (!spec) return <p className="editor-message">This collection has no editable schema.</p>;
  if (query.isPending) return <p className="editor-message" role="status">Loading editable fields…</p>;
  if (query.isError) return <p className="editor-message" role="alert">{query.error.message} <button className="button" onClick={() => void query.refetch()}>Retry</button></p>;
  if (editableRecord(query.data, spec, recordId) === undefined) return <p className="editor-message" role="alert">This record no longer exists. Your other content has not changed.</p>;
  return <DraftEditor key={`${collection}:${recordId}`} spec={spec} recordId={recordId} initial={query.data}/>;
}

function DraftEditor({ spec, recordId, initial }: { spec: ContentCollection; recordId: string; initial: CollectionResponse }) {
  const queryClient = useQueryClient();
  const [revision, setRevision] = useState(initial.revision);
  const [serverIssues, setServerIssues] = useState<SchemaIssue[]>([]);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [resetting, setResetting] = useState(false);
  const form = useForm<Draft>({ mode: "onChange", defaultValues: { record: structuredClone(editableRecord(initial, spec, recordId)) } });
  const controller = useController({ name: "record", control: form.control, rules: { validate: value => fieldIssues(spec.schema, value).every(issue => issue.severity !== "error") || "Check the highlighted fields." } });
  const value = controller.field.value;
  const formulaLinked = asObject(value).derivation !== undefined;
  const balances = useQueries({ queries: balanceCollections.map(collection => ({ ...collectionQuery(collection.name), enabled: formulaLinked })) });
  const formula = useMemo(() => {
    if (!formulaLinked) return { keys: [] as string[], blocked: false, message: "" };
    const protectAll = Object.keys(asObject(value)).filter(key => key !== "derivation");
    if (balances.some(query => query.isPending)) return { keys: protectAll, blocked: true, message: "Loading formula parameters. Fields remain protected until the formula can be checked." };
    if (balances.some(query => query.isError)) return { keys: protectAll, blocked: true, message: "Formula parameters could not be loaded. Fields remain protected and saving is paused. Retry loading, or remove the formula link to hand tune this record." };
    try {
      const tables = new Map(balances.flatMap(query => query.data ? [[query.data.collection.name, query.data.data] as const] : []));
      tables.set(spec.name, initial.data);
      // Only the field keys are needed. Use the valid saved row so an unrelated invalid draft
      // value cannot prevent the user correcting that field while its formula stays linked.
      const saved = asObject(editableRecord(initial, spec, recordId));
      const derived = deriveRecord(spec.name, { ...saved, derivation: asObject(value).derivation }, tables);
      return { keys: Object.keys(derived ?? {}), blocked: false, message: "Formula-controlled fields are read only. Remove the formula link below to hand tune them." };
    } catch (error) { return { keys: protectAll, blocked: true, message: `The formula could not be checked. Fields remain protected. ${error instanceof Error ? error.message : "Retry loading the parameters."}` }; }
  }, [formulaLinked, value, balances, initial, spec, recordId]);
  const clientIssues = useMemo(() => fieldIssues(spec.schema, value), [spec.schema, value]);
  const issues = [...clientIssues, ...serverIssues];
  const invalid = clientIssues.some(issue => issue.severity === "error");
  const busy = form.formState.isSubmitting || resetting;
  const focusSection = spec.shape === "object" && recordId !== "$collection" ? recordId : undefined;
  function change(next: unknown) { controller.field.onChange(next); setServerIssues([]); if (!conflict) setSaveError(""); }
  async function save(draft: Draft) {
    if (conflict || formula.blocked) return;
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
      queryClient.setQueryData(collectionQuery(spec.name).queryKey, body);
      setRevision(body.revision);
      form.reset({ record: structuredClone(saved) });
      setServerIssues((body.diagnostics ?? []).map(issue => ({ ...issue, path: diagnosticPath(issue.path, spec.name) })));
      toast.success("Changes saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The save could not be completed. Your draft is still here.");
    }
  }
  async function resetDraft() {
    setResetting(true);
    try {
      const response = await queryClient.fetchQuery({ ...collectionQuery(spec.name), staleTime: 0 });
      const fresh = editableRecord(response, spec, recordId);
      if (fresh === undefined) throw new Error("The record no longer exists. The draft has been kept.");
      form.reset({ record: structuredClone(fresh) }); setRevision(response.revision); setSaveError(""); setServerIssues([]); setConflict(false);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Could not reload the file. The draft has been kept."); }
    finally { setResetting(false); }
  }
  return <form className="entity-editor" onSubmit={form.handleSubmit(save)} noValidate><div className="editor-toolbar"><div><h2>Edit content</h2><p>{spec.shape === "object" ? "Save updates this parameter file. All sections are included." : "Changes are validated before they are saved."}</p></div><div className="editor-actions"><span className="editor-dirty" role="status">{form.formState.isDirty ? "Unsaved changes" : <><Check size={13}/> Saved</>}</span><button type="button" className="button" disabled={busy || (!form.formState.isDirty && !conflict)} onClick={() => void resetDraft()}><RotateCcw size={14}/>{resetting ? "Reloading…" : "Reset draft"}</button><button type="submit" className="button editor-save" disabled={busy || !form.formState.isDirty || invalid || conflict || formula.blocked}><Save size={14}/>{form.formState.isSubmitting ? "Saving…" : "Save changes"}</button></div></div>{formulaLinked && <div className="editor-formula-notice" role="status"><LockKeyhole size={15}/><p>{formula.message}</p>{formula.blocked && <button type="button" className="editor-small-button" onClick={() => balances.forEach(query => void query.refetch())}>Retry parameters</button>}</div>}{saveError && <div className="editor-error-summary" role="alert"><AlertCircle size={17}/><p>{saveError}</p></div>}{issues.length > 0 && <div className="editor-diagnostics" aria-label="Validation diagnostics"><h3>{issues.filter(issue => issue.severity === "error").length ? "Review these fields" : "Validation notes"}</h3><ul>{issues.map((issue, index) => <li key={`${issue.path}:${index}`}><button type="button" onClick={() => { const target = document.getElementById(elementId(issue.path)); target?.scrollIntoView({ block: "center", behavior: "instant" }); target?.querySelector<HTMLElement>("input,select,textarea,button")?.focus(); }}><span>{issue.path || "Record"}</span> {issue.message}</button></li>)}</ul></div>}<fieldset disabled={busy} className="editor-fields"><FieldNode schema={spec.schema} value={value} onChange={change} name="record" path="" issues={issues} root idKey={spec.shape === "array" ? spec.idKey : undefined} focusSection={focusSection} lockedKeys={formula.keys}/></fieldset></form>;
}

interface FieldNodeProps { schema: Schema; value: unknown; onChange: Change; name: string; path: string; issues: SchemaIssue[]; locked?: boolean; root?: boolean; idKey?: string; focusSection?: string; lockedKeys?: string[]; lockedReason?: string; embedded?: boolean }
function FieldNode({ schema, value, onChange, name, path, issues, locked = false, root = false, idKey, focusSection, lockedKeys, lockedReason, embedded = false }: FieldNodeProps) {
  const spec = serialFieldSpec(schema, name);
  const node = fieldCore(schema);
  if (spec.hidden) return null;
  const formulaTag = path === "derivation";
  const readOnly = locked || formulaTag || Boolean(spec.readOnly || spec.identity);
  const ownIssues = issues.filter(issue => issue.path === path);
  const helpId = `${elementId(path)}-help`;
  const errorId = `${elementId(path)}-error`;
  const fieldProps = { "aria-label": spec.label, "aria-describedby": `${helpId}${ownIssues.length ? ` ${errorId}` : ""}`, "aria-invalid": ownIssues.some(issue => issue.severity === "error") || undefined };
  const replaceKey = (key: string, next: unknown) => { const copy = { ...asObject(value) }; if (next === undefined) delete copy[key]; else Object.defineProperty(copy, key, { value: next, enumerable: true, writable: true, configurable: true }); onChange(copy); };
  let content: React.ReactNode;
  if (value === undefined && spec.optional) content = <div className="editor-unset"><span>Not set</span>{!readOnly && <button type="button" className="editor-small-button" onClick={() => onChange(defaultFieldValue(node))}><Plus size={13}/>Add {spec.label.toLowerCase()}</button>}</div>;
  else if (value === null && spec.nullable) content = <div className="editor-unset"><span>No value</span>{!readOnly && <button type="button" className="editor-small-button" onClick={() => onChange(defaultFieldValue(node))}>Set value</button>}</div>;
  else if (readOnly) content = <div className="editor-locked"><ReadValue value={value}/><span><LockKeyhole size={12}/> {lockedReason ?? (formulaTag ? "Formula link" : spec.identity || name === "count" || name === "legacyCount" ? "Save identity" : "Read only")}</span></div>;
  else if (spec.choices) content = spec.kind === "literal" ? <span className="editor-literal">{String(value)}</span> : <select {...fieldProps} value={String(spec.choices.findIndex(choice => choice === value))} onChange={event => onChange(spec.choices![Number(event.target.value)])}>{!spec.choices.includes(value as string) && <option value="-1">Choose a value</option>}{spec.choices.map((choice, index) => <option key={index} value={index}>{String(choice)}</option>)}</select>;
  else if (node.kind === "boolean") content = <label className="editor-checkbox"><input {...fieldProps} type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)}/>{value ? "Yes" : "No"}</label>;
  else if (node.kind === "number") content = <div className="editor-number"><input {...fieldProps} type="number" value={typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" ? value : ""} min={spec.min} max={spec.max} step={spec.step ?? "any"} onChange={event => onChange(event.target.value === "" ? "" : event.target.valueAsNumber)}/>{spec.unit && <span>{spec.unit}</span>}</div>;
  else if (node.kind === "string") content = spec.multiline ? <textarea {...fieldProps} value={typeof value === "string" ? value : ""} minLength={spec.minLength} maxLength={spec.maxLength} rows={3} onChange={event => onChange(event.target.value)}/> : <ReferenceInput spec={spec} path={path} value={value} onChange={onChange} fieldProps={fieldProps}/>;
  else if (node instanceof ObjectSchema) {
    const entries = Object.entries(node.fields) as [string, Schema][];
    if (focusSection) entries.sort(([a], [b]) => a === focusSection ? -1 : b === focusSection ? 1 : 0);
    content = <div className={root ? "editor-root-fields" : "editor-object"}>{entries.map(([key, field]) => <FieldNode key={key} schema={field} value={asObject(value)[key]} onChange={next => replaceKey(key, next)} name={key} path={childPath(path, key)} issues={issues} locked={root && (key === idKey || lockedKeys?.includes(key))} lockedReason={root && lockedKeys?.includes(key) ? "Controlled by formula" : undefined}/>)}{Object.keys(asObject(value)).filter(key => !Object.hasOwn(node.fields, key)).map(key => <div className="editor-preserved" key={key}><strong>{fieldTitle(key)}</strong><ReadValue value={asObject(value)[key]}/><small>Unrecognized field preserved in this draft.</small></div>)}</div>;
  } else if (node instanceof ArraySchema || node instanceof TupleSchema) {
    const entries = Array.isArray(value) ? value : [];
    const fixed = node instanceof TupleSchema;
    const identity = !fixed && containsIdentity(node.item);
    content = <div className="editor-array">{entries.map((entry, index) => { const entrySchema = node instanceof TupleSchema ? node.items[index] : node.item; if (!entrySchema) return <ReadValue value={entry} key={index}/>; return <div className="editor-array-entry" key={index}><div className="editor-array-heading"><span>{index + 1}{typeof asObject(entry).name === "string" ? ` · ${asObject(entry).name}` : ""}</span>{!fixed && !identity && <button type="button" className="editor-small-button" aria-label={`Remove ${spec.label.toLowerCase()} entry ${index + 1}`} disabled={entries.length <= (spec.minLength ?? 0)} onClick={() => onChange(entries.filter((_, i) => index !== i))}><Trash2 size={12}/>Remove</button>}</div><FieldNode schema={entrySchema} value={entry} onChange={next => onChange(entries.map((existing, i) => i === index ? next : existing))} name={`Entry ${index + 1}`} path={childPath(path, index)} issues={issues} root/></div>; })}{!entries.length && <p className="editor-empty">No entries.</p>}{!fixed && !identity && <button type="button" className="editor-small-button" disabled={spec.maxLength !== undefined && entries.length >= spec.maxLength} onClick={() => onChange([...entries, defaultFieldValue(node.item)])}><Plus size={13}/>Add entry</button>}{identity && <p className="editor-help">Entry order and membership are fixed because these records contain save identity.</p>}</div>;
  } else if (node instanceof RecordSchema) content = <RecordFields schema={node} value={asObject(value)} path={path} issues={issues} onChange={onChange}/>;
  else if (node instanceof UnionSchema || node instanceof DiscriminatedSchema) {
    const selected = unionVariant(node, value);
    const member = node instanceof DiscriminatedSchema ? node.members[selected] : node.members[Number(selected)];
    content = <div className="editor-union"><label className="editor-union-choice"><span>{spec.discriminator ? fieldTitle(spec.discriminator) : "Value type"}</span><select aria-label={`${spec.label} ${spec.discriminator ?? "value type"}`} value={selected} disabled={containsIdentity(node)} onChange={event => { const next = node instanceof DiscriminatedSchema ? node.members[event.target.value] : node.members[Number(event.target.value)]; if (next) onChange(defaultFieldValue(next)); }}>{spec.variants?.map(variant => <option key={variant.key} value={variant.key}>{variant.label}</option>)}</select></label><p className="editor-help">Changing the type replaces the fields in this section.</p>{member && <FieldNode schema={member} value={value} onChange={onChange} name={name} path={path} issues={issues} root embedded/>}</div>;
  } else content = <div className="editor-preserved"><ReadValue value={value}/><small>This value is preserved. No typed editor is available for it.</small></div>;
  const bounds = [spec.min !== undefined && `Minimum ${spec.min}`, spec.max !== undefined && `maximum ${spec.max}`, spec.exclusiveMin !== undefined && `greater than ${spec.exclusiveMin}`, spec.exclusiveMax !== undefined && `less than ${spec.exclusiveMax}`, spec.integer && "whole numbers"].filter(Boolean).join("; ");
  return <div id={embedded ? undefined : elementId(path)} className={`${root ? "editor-root" : "editor-field"}${ownIssues.some(issue => issue.severity === "error") ? " has-error" : ""}`}>
    {!root && <div className="editor-field-label"><span>{spec.label}{spec.optional && <small>Optional</small>}</span><div>{(!readOnly || formulaTag) && value !== undefined && spec.optional && <button type="button" className="editor-small-button" onClick={() => onChange(undefined)}>{name === "derivation" ? "Remove formula link" : "Remove"}</button>}{!readOnly && value !== null && value !== undefined && spec.nullable && <button type="button" className="editor-small-button" onClick={() => onChange(null)}>Set to no value</button>}</div></div>}
    <div className="editor-field-content">{content}<div id={helpId} className="editor-help">{spec.help && <p>{spec.help}</p>}{spec.ref && <p>Reference to {fieldTitle(spec.ref).toLowerCase()}.</p>}{bounds && <p>{bounds}.</p>}{spec.refinements.map(rule => <p key={rule}>{rule}.</p>)}{name === "derivation" && value !== undefined && <p>Removing this link makes the record hand tuned. Linked stats must match their formula to save.</p>}</div>{ownIssues.length > 0 && <ul id={errorId} className="editor-field-errors">{ownIssues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}</div>
  </div>;
}

function ReferenceInput({ spec, path, value, onChange, fieldProps }: { spec: SerialFieldSpec; path: string; value: unknown; onChange: Change; fieldProps: { "aria-label": string; "aria-describedby": string; "aria-invalid": boolean | undefined } }) {
  const target = spec.ref ? refs[spec.ref] : undefined;
  const collections = useQuery({ ...collectionsQuery(), enabled: Boolean(target) });
  const available = Boolean(target && collections.data?.some(collection => collection.name === target));
  const query = useQuery({ ...collectionQuery(target ?? ""), enabled: available });
  const options = query.data ? contentRows(query.data) : [];
  const list = `references-${encodeURIComponent(path)}`;
  return <><input {...fieldProps} value={typeof value === "string" ? value : ""} type="text" minLength={spec.minLength} maxLength={spec.maxLength} pattern={spec.pattern} list={available ? list : undefined} onChange={event => onChange(event.target.value)}/>{available && <datalist id={list}>{options.map(record => <option key={rowId(record, query.data!.collection.idKey)} value={rowId(record, query.data!.collection.idKey)}>{rowName(record, query.data!.collection.idKey)}</option>)}</datalist>}</>;
}

function RecordFields({ schema, value, path, issues, onChange }: { schema: RecordSchema<string, unknown>; value: Record<string, unknown>; path: string; issues: SchemaIssue[]; onChange: Change }) {
  const [key, setKey] = useState("");
  const keyIssues = schema.key && key ? fieldIssues(schema.key, key) : [];
  const identity = containsIdentity(schema.value);
  const validKey = Boolean(key && !Object.hasOwn(value, key) && !badKeys.has(key) && !keyIssues.length);
  return <div className="editor-record">{Object.entries(value).map(([entryKey, entry]) => <div className="editor-record-entry" key={entryKey}><FieldNode schema={schema.value} value={entry} onChange={next => onChange({ ...value, [entryKey]: next })} name={entryKey} path={childPath(path, entryKey)} issues={issues}/>{!identity && <button type="button" className="editor-small-button" aria-label={`Remove ${entryKey}`} onClick={() => { const next = { ...value }; delete next[entryKey]; onChange(next); }}><Trash2 size={12}/>Remove {entryKey}</button>}</div>)}{!identity && <div className="editor-record-add"><label>New key<input aria-label={`New key for ${path || "record"}`} value={key} onChange={event => setKey(event.target.value)} placeholder="Enter a key"/></label><button type="button" className="editor-small-button" disabled={!validKey} onClick={() => { if (validKey) { onChange({ ...value, [key]: defaultFieldValue(schema.value) }); setKey(""); } }}><Plus size={13}/>Add key</button>{key && !validKey && <p className="editor-help">{Object.hasOwn(value, key) ? "This key already exists." : keyIssues[0]?.message ?? "Choose a different key."}</p>}</div>}</div>;
}

function ReadValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="editor-empty">{value === null ? "No value" : "Not set"}</span>;
  if (typeof value !== "object") return <span className="editor-read-value">{String(value)}</span>;
  if (Array.isArray(value)) return <ul className="editor-read-list">{value.map((entry, index) => <li key={index}><ReadValue value={entry}/></li>)}</ul>;
  return <dl className="editor-read-object">{Object.entries(value).map(([key, entry]) => <div key={key}><dt>{fieldTitle(key)}</dt><dd><ReadValue value={entry}/></dd></div>)}</dl>;
}
