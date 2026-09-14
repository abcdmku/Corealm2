import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Sparkles } from 'lucide-react';
import { FormulaWorkspace, formulasQuery } from './formulas/FormulaWorkspace.js';
import './recordFormula.css';
export default function RecordFormulaStatus(props: { collection: string; recordId: string }) {
  const query = useQuery(formulasQuery);
  const formulas = query.data?.formulas.filter(formula => formula.consumers.some(consumer => consumer.record === `${props.collection}:${props.recordId}` || consumer.collection === props.collection && consumer.id === props.recordId));
  if (!formulas?.length) return null;
  return <section className="record-formula" aria-label="Calculated values">
    <div className="record-formula-row">
      <span className="badge" data-tone="accent"><Sparkles size={11} />Calculated</span>
      {formulas.map(formula => <a key={formula.id} className="text-button" href={formula.source.url} title={`${formula.source.file}:${formula.source.line}`}>{formula.title}</a>)}
      <span className="record-formula-hint">Values resolve from tier and profile; record adjustments apply after.</span>
    </div>
    <details className="record-formula-details"><summary><ChevronRight size={12} />Inspect inputs, parameters and consumers</summary><div className="record-formula-workspace"><FormulaWorkspace {...props} /></div></details>
  </section>;
}
