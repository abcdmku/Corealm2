import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FormulaDescription, FormulaPreviewResponse, FormulasResponse } from '../../../shared/formulas.js';
import './formulas.css';
export const formulasQuery = { queryKey:['formulas'], queryFn:async():Promise<FormulasResponse>=>{const response=await fetch('/__devdocs/formulas');const body=await response.json();if(!response.ok)throw new Error(body.error ?? 'Unable to load formulas');return body;}, refetchInterval:3000 };
export function FormulaWorkspace({ collection, recordId }: { collection?:string; recordId?:string }) {
  const query=useQuery(formulasQuery);
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState('');
  if(query.isPending)return <p>Loading formulas...</p>;
  if(query.isError)return <p role="alert">{query.error.message}</p>;
  const formulas=query.data.formulas.filter(formula=>(!collection || formula.profilesCollection===collection || formula.consumers.some(c=>(c.collection===collection || c.record.startsWith(`${collection}:`)) && (!recordId || c.id===recordId || c.record===`${collection}:${recordId}`))) && `${formula.id} ${formula.title}`.toLowerCase().includes(search.toLowerCase()));
  const active=formulas.find(formula=>formula.id===selected) ?? formulas[0];
  return <section className="formula-workspace"><p role="status">Build: {query.data.build.state}{query.data.build.revision ? `  /  ${query.data.build.revision.slice(0,12)}`:''}</p>
    {query.data.build.state==='invalid' && <p>The last valid catalog remains active. Fix the source diagnostics to rebuild.</p>}
    {query.data.build.diagnostics.map((issue,index)=><p role="alert" key={index}><code>{issue.path}</code> {issue.message}</p>)}
    <label>Find a formula<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Name or formula ID"/></label>
    <div className="formula-workspace-layout"><nav aria-label="Formula index">{formulas.map(formula=><button type="button" key={formula.id} aria-current={active?.id===formula.id} onClick={()=>setSelected(formula.id)}>{formula.title}<small>{formula.id}</small></button>)}</nav>
    {active ? <FormulaInspector key={`${active.id}:${recordId ?? ''}`} formula={active} recordId={recordId}/> : <p>No registered formula applies to this selection.</p>}</div></section>;
}
function NumericFields({value,onChange,prefix=''}:{value:unknown;onChange:(value:unknown)=>void;prefix?:string}) {
  if(typeof value==='string')return <label>{prefix}<input value={value} onChange={event=>onChange(event.target.value)}/></label>;
  if(typeof value==='number')return <label>{prefix}<input type="number" step="any" value={Number.isFinite(value)?value:''} onChange={event=>onChange(event.target.value===''?NaN:Number(event.target.value))}/></label>;
  if(value && typeof value==='object' && !Array.isArray(value))return <>{Object.entries(value).map(([key,child])=><NumericFields key={key} prefix={prefix?`${prefix}.${key}`:key} value={child} onChange={next=>onChange({...value,[key]:next})}/>)}</>;
  return null;
}
function FormulaInspector({formula,recordId}:{formula:FormulaDescription;recordId?:string}) {
  const profiles=useQuery({queryKey:['formula-profiles',formula.profilesCollection],queryFn:async()=>{const response=await fetch(`/__devdocs/collections/${encodeURIComponent(formula.profilesCollection)}`);if(!response.ok)throw new Error('Unable to load saved profiles');return response.json() as Promise<{data: {id:string;name?:string;parameters?:unknown}[]}>;}});
  const consumer=formula.consumers.find(row=>row.record.endsWith(`:${recordId}`) || row.id===recordId);
  const [profileId,setProfileId]=useState(consumer?.profile ?? recordId ?? '');
  const [input,setInput]=useState<unknown>(consumer?.inputs ? {tier:consumer.inputs.tier ?? consumer.inputs.level} : formula.defaultInput);
  const [parameters,setParameters]=useState(formula.defaultParameters);
  const [preview,setPreview]=useState<FormulaPreviewResponse>();
  const [before,setBefore]=useState<unknown>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{const profile=profiles.data?.data.find(row=>row.id===profileId);if(profile){setParameters(profile.parameters ?? profile);setBefore(undefined);setPreview(undefined);}},[profileId,profiles.data]);
  async function calculate(){setBusy(true);setError('');try{const response=await fetch('/__devdocs/formulas/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({formulaId:formula.id,input,parameters,profileId:profileId || undefined})});const body=await response.json();if(!response.ok)throw new Error(body.error);const saved=profiles.data?.data.find(row=>row.id===profileId);
const baselineResponse=await fetch('/__devdocs/formulas/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({formulaId:formula.id,input,parameters:saved ? saved.parameters ?? saved : formula.defaultParameters})});
const baseline=await baselineResponse.json();if(!baselineResponse.ok)throw new Error(baseline.error);setBefore(baseline.result);setPreview(body);}catch(error){setError(error instanceof Error?error.message:'Calculation failed');}finally{setBusy(false);}}
  return <article><h2>{formula.title}</h2><p>{formula.description}</p><a href={formula.source.url}>Open {formula.source.symbol} in VS Code</a><p><code>{formula.source.file}:{formula.source.line}</code></p><p>Saving the TypeScript source runs project checks and rebuilds the catalog. Save profile changes in the profile editor.</p>
    <label>Saved profile<select value={profileId} onChange={event=>setProfileId(event.target.value)}><option value="">Example parameters</option>{profiles.data?.data.map(row=><option key={row.id} value={row.id}>{row.name ?? row.id}</option>)}</select></label>
    {profiles.isError && <p role="alert">{profiles.error.message}</p>}
    {profileId && <a href={`#/${encodeURIComponent(formula.profilesCollection)}/${encodeURIComponent(profileId)}`}>Edit and save this profile</a>}
    <h3>Example inputs</h3><div className="formula-fields"><NumericFields value={input} onChange={setInput}/></div><h3>Preview parameters</h3><div className="formula-fields"><NumericFields value={parameters} onChange={setParameters}/></div>
    <button type="button" className="button" disabled={busy} onClick={()=>void calculate()}>{busy?'Calculating...':'Preview result and tier curve'}</button>{error && <pre role="alert">{error}</pre>}
    {preview && <><h3>Formula example before record adjustments</h3><div className="formula-results"><div>Saved profile result<pre>{JSON.stringify(before,null,2)}</pre></div><div>Current preview<pre>{JSON.stringify(preview.result,null,2)}</pre></div></div><h3>Tier examples</h3><table><thead><tr><th>Tier</th><th>Resolved values</th></tr></thead><tbody>{preview.examples.map(example=><tr key={example.tier}><th>{example.tier}</th><td><pre>{JSON.stringify(example.result,null,2)}</pre></td></tr>)}</tbody></table></>}
    <h3>Compiled impact, including inherited and explicit adjustments</h3>{preview?.impacts?.length ? <table><thead><tr><th>Consumer</th><th>Saved compiled record</th><th>Preview compiled record</th></tr></thead><tbody>{preview.impacts.map(impact=><tr key={impact.record}><th>{impact.record}</th><td><pre>{JSON.stringify(impact.before,null,2)}</pre></td><td><pre>{JSON.stringify(impact.after,null,2)}</pre></td></tr>)}</tbody></table> : <p>{preview && profileId ? 'No compiled records change with these parameters.' : 'Select a saved profile and preview to inspect affected records.'}</p>}<h3>Consumers ({formula.consumers.length})</h3><ul>{formula.consumers.map(consumer=><li key={consumer.record}><a href={`#/${consumer.record.split(':').map(encodeURIComponent).join('/')}`}>{consumer.record}</a>  /  profile {consumer.profile}<details><summary>Actual inputs</summary><pre>{JSON.stringify(consumer.inputs,null,2)}</pre></details></li>)}</ul>
  </article>;
}





