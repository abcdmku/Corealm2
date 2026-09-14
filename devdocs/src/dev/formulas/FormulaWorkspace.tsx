import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, Code2, Play, Search } from 'lucide-react';
import type { FormulaDescription, FormulaPreviewResponse, FormulasResponse } from '../../../shared/formulas.js';
import './formulas.css';

export const formulasQuery = { queryKey: ['formulas'], queryFn: async (): Promise<FormulasResponse> => { const response = await fetch('/__devdocs/formulas'); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Unable to load formulas'); return body; }, refetchInterval: 3000 };

type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'info' | undefined;

function buildTone(state: FormulasResponse['build']['state']): Tone {
  return state === 'valid' ? 'ok' : state === 'invalid' ? 'danger' : state === 'checking' ? 'info' : undefined;
}

export function FormulaWorkspace({ collection, recordId }: { collection?: string; recordId?: string }) {
  const query = useQuery(formulasQuery);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  if (query.isPending) return <p className="empty-inline">Loading formulas…</p>;
  if (query.isError) return <p role="alert" className="formula-error">{query.error.message}</p>;
  const formulas = query.data.formulas.filter(formula => (!collection || formula.profilesCollection === collection || formula.consumers.some(c => (c.collection === collection || c.record.startsWith(`${collection}:`)) && (!recordId || c.id === recordId || c.record === `${collection}:${recordId}`))) && `${formula.id} ${formula.title}`.toLowerCase().includes(search.toLowerCase()));
  const active = formulas.find(formula => formula.id === selected) ?? formulas[0];
  const build = query.data.build;
  return <section className="formula-workspace">
    <div className="formula-build">
      <p role="status" className="formula-build-status"><span className="badge" data-tone={buildTone(build.state)}>Build: {build.state}</span>{build.revision && <code>{build.revision.slice(0, 12)}</code>}{build.state === 'invalid' && <span className="formula-build-hint">Last valid catalog stays active until the diagnostics are fixed.</span>}</p>
      {build.diagnostics.map((issue, index) => <p role="alert" className="formula-error" key={index}><code>{issue.path}</code> {issue.message}</p>)}
    </div>
    <div className="formula-layout">
      <aside className="panel formula-index">
        <div className="panel-header formula-index-header"><label className="search-field formula-search"><Search size={14} /><input aria-label="Find a formula" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a formula…" /></label></div>
        <nav aria-label="Formula index" className="formula-nav">
          {formulas.map(formula => <button type="button" key={formula.id} aria-current={active?.id === formula.id} className={active?.id === formula.id ? 'is-active' : ''} onClick={() => setSelected(formula.id)}><span className="formula-nav-title">{formula.title}</span><small>{formula.id}</small><ChevronRight size={12} className="formula-nav-chevron" /></button>)}
          {!formulas.length && <p className="empty-inline" style={{ padding: '8px 10px' }}>No formulas match.</p>}
        </nav>
      </aside>
      {active ? <FormulaInspector key={`${active.id}:${recordId ?? ''}`} formula={active} recordId={recordId} /> : <p className="empty-inline">No registered formula applies to this selection.</p>}
    </div>
  </section>;
}

function NumericFields({ value, onChange, prefix = '' }: { value: unknown; onChange: (value: unknown) => void; prefix?: string }) {
  if (typeof value === 'string') return <label className="stat formula-field"><span title={prefix}>{prefix}</span><input value={value} onChange={event => onChange(event.target.value)} /></label>;
  if (typeof value === 'number') return <label className="stat formula-field"><span title={prefix}>{prefix}</span><input type="number" step="any" value={Number.isFinite(value) ? value : ''} onChange={event => onChange(event.target.value === '' ? NaN : Number(event.target.value))} /></label>;
  if (value && typeof value === 'object' && !Array.isArray(value)) return <>{Object.entries(value).map(([key, child]) => <NumericFields key={key} prefix={prefix ? `${prefix}.${key}` : key} value={child} onChange={next => onChange({ ...value, [key]: next })} />)}</>;
  return null;
}

function formatScalar(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  if (value === null || value === undefined) return '—';
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function splitResult(value: Record<string, unknown>): { scalars: [string, unknown][]; nested: Record<string, unknown> } {
  const scalars: [string, unknown][] = [];
  const nested: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) { if (entry === null || typeof entry !== 'object') scalars.push([key, entry]); else nested[key] = entry; }
  return { scalars, nested };
}

/** Formula results as stat tiles for scalar fields, with any nested values as JSON underneath. */
function ResultStats({ value, accent = false }: { value: unknown; accent?: boolean }) {
  if (!isPlainObject(value)) return <div className="stat-grid formula-stats"><div className="stat" data-accent={accent || undefined}><span>result</span><strong>{typeof value === 'object' ? JSON.stringify(value) : formatScalar(value)}</strong></div></div>;
  const { scalars, nested } = splitResult(value);
  return <>
    {scalars.length > 0 && <div className="stat-grid formula-stats">{scalars.map(([key, entry]) => <div className="stat" key={key} data-accent={accent || undefined}><span title={key}>{key}</span><strong>{formatScalar(entry)}</strong></div>)}</div>}
    {Object.keys(nested).length > 0 && <pre className="formula-json">{JSON.stringify(nested, null, 2)}</pre>}
  </>;
}

function compactResult(value: unknown): React.ReactNode {
  if (!isPlainObject(value)) return typeof value === 'object' && value !== null ? <pre className="formula-json">{JSON.stringify(value, null, 2)}</pre> : formatScalar(value);
  const { scalars, nested } = splitResult(value);
  return <>
    {scalars.length > 0 && <span className="formula-inline-stats">{scalars.map(([key, entry]) => <span key={key}><small>{key}</small>{formatScalar(entry)}</span>)}</span>}
    {Object.keys(nested).length > 0 && <pre className="formula-json">{JSON.stringify(nested, null, 2)}</pre>}
  </>;
}

function FormulaInspector({ formula, recordId }: { formula: FormulaDescription; recordId?: string }) {
  const profiles = useQuery({ queryKey: ['formula-profiles', formula.profilesCollection], queryFn: async () => { const response = await fetch(`/__devdocs/collections/${encodeURIComponent(formula.profilesCollection)}`); if (!response.ok) throw new Error('Unable to load saved profiles'); return response.json() as Promise<{ data: { id: string; name?: string; parameters?: unknown }[] }>; } });
  const consumer = formula.consumers.find(row => row.record.endsWith(`:${recordId}`) || row.id === recordId);
  const [profileId, setProfileId] = useState(consumer?.profile ?? recordId ?? '');
  const [input, setInput] = useState<unknown>(consumer?.inputs ? { tier: consumer.inputs.tier ?? consumer.inputs.level } : formula.defaultInput);
  const [parameters, setParameters] = useState(formula.defaultParameters);
  const [preview, setPreview] = useState<FormulaPreviewResponse>();
  const [before, setBefore] = useState<unknown>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const profile = profiles.data?.data.find(row => row.id === profileId); if (profile) { setParameters(profile.parameters ?? profile); setBefore(undefined); setPreview(undefined); } }, [profileId, profiles.data]);
  async function calculate() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/__devdocs/formulas/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formulaId: formula.id, input, parameters, profileId: profileId || undefined }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); const saved = profiles.data?.data.find(row => row.id === profileId);
      const baselineResponse = await fetch('/__devdocs/formulas/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formulaId: formula.id, input, parameters: saved ? saved.parameters ?? saved : formula.defaultParameters }) });
      const baseline = await baselineResponse.json(); if (!baselineResponse.ok) throw new Error(baseline.error); setBefore(baseline.result); setPreview(body);
    } catch (error) { setError(error instanceof Error ? error.message : 'Calculation failed'); } finally { setBusy(false); }
  }
  const impacts = preview?.impacts ?? [];
  return <article className="panel formula-inspector">
    <header className="panel-header formula-inspector-header">
      <h2 className="formula-inspector-title" title={formula.id}>{formula.title}</h2>
      <code className="formula-source" title={`${formula.source.file}:${formula.source.line}`}>{formula.source.file.split('/').at(-1)}:{formula.source.line}</code>
      <div className="panel-header-actions"><a className="button button-small" href={formula.source.url}><Code2 size={13} />{formula.source.symbol}</a></div>
    </header>
    <div className="panel-body formula-inspector-body">
      {formula.description && <p className="formula-description">{formula.description}</p>}
      <div className="formula-controls">
        <label className="select"><span className="sr-only">Saved profile</span><select aria-label="Saved profile" value={profileId} onChange={event => setProfileId(event.target.value)}><option value="">Example parameters</option>{profiles.data?.data.map(row => <option key={row.id} value={row.id}>{row.name ?? row.id}</option>)}</select></label>
        {profileId && <a className="text-button" href={`#/${encodeURIComponent(formula.profilesCollection)}/${encodeURIComponent(profileId)}`}>Edit profile <ArrowRight size={12} /></a>}
        <span className="formula-controls-spacer" />
        <button type="button" className="button button-small button-primary" disabled={busy} onClick={() => void calculate()}><Play size={12} />{busy ? 'Calculating…' : 'Preview'}</button>
      </div>
      {profiles.isError && <p role="alert" className="formula-error">{profiles.error.message}</p>}
      <section className="formula-section"><div className="section-heading"><h3>Inputs</h3></div><div className="stat-grid formula-fields"><NumericFields value={input} onChange={setInput} /></div></section>
      <section className="formula-section"><div className="section-heading"><h3>Parameters</h3><span>{profileId || 'defaults'}</span></div><div className="stat-grid formula-fields"><NumericFields value={parameters} onChange={setParameters} /></div></section>
      {error && <pre role="alert" className="formula-error">{error}</pre>}
      {preview && <>
        <section className="formula-section">
          <div className="section-heading"><h3>Result</h3><span>saved → preview</span></div>
          <div className="formula-compare">
            <div className="formula-compare-column"><span className="formula-compare-label">Saved profile</span><ResultStats value={before} /></div>
            <div className="formula-compare-column"><span className="formula-compare-label">Preview</span><ResultStats value={preview.result} accent /></div>
          </div>
        </section>
        <section className="formula-section">
          <div className="section-heading"><h3>Tier examples</h3><span>{preview.examples.length}</span></div>
          <div className="formula-table-scroll"><table className="formula-table"><thead><tr><th>Tier</th><th>Resolved values</th></tr></thead><tbody>{preview.examples.map(example => <tr key={example.tier}><th><span className="tier-tag">{example.tier}</span></th><td>{compactResult(example.result)}</td></tr>)}</tbody></table></div>
        </section>
      </>}
      <section className="formula-section">
        <div className="section-heading"><h3>Compiled impact</h3><span>{preview ? impacts.length : '—'}</span></div>
        {impacts.length
          ? <div className="formula-table-scroll"><table className="formula-table"><thead><tr><th>Consumer</th><th>Saved</th><th>Preview</th></tr></thead><tbody>{impacts.map(impact => <tr key={impact.record}><th><code>{impact.record}</code></th><td>{compactResult(impact.before)}</td><td className="formula-after">{compactResult(impact.after)}</td></tr>)}</tbody></table></div>
          : <p className="empty-inline">{preview && profileId ? 'No compiled records change with these parameters.' : 'Pick a saved profile and preview to see affected records.'}</p>}
      </section>
      <section className="formula-section">
        <div className="section-heading"><h3>Consumers</h3><span>{formula.consumers.length}</span></div>
        <ul className="ref-rows formula-consumers">{formula.consumers.map(consumer => <li key={consumer.record} className="ref-row formula-consumer">
          <a className="reference-link" href={`#/${consumer.record.split(':').map(encodeURIComponent).join('/')}`}>{consumer.record}<ChevronRight size={12} /></a>
          {consumer.profile && <span className="badge">{consumer.profile}</span>}
          <details className="formula-consumer-inputs"><summary>Inputs</summary><pre className="formula-json">{JSON.stringify(consumer.inputs, null, 2)}</pre></details>
        </li>)}</ul>
      </section>
    </div>
  </article>;
}
