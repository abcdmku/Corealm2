import { useQuery } from '@tanstack/react-query';
import { FormulaWorkspace, formulasQuery } from './formulas/FormulaWorkspace.js';
export default function RecordFormulaStatus(props:{collection:string;recordId:string}) {
  const query=useQuery(formulasQuery);
  const formulas=query.data?.formulas.filter(formula=>formula.consumers.some(consumer=>consumer.record===`${props.collection}:${props.recordId}` || consumer.collection===props.collection && consumer.id===props.recordId));
  if(!formulas?.length)return null;
  return <section className="record-formula"><h2>Calculated values</h2>{formulas.map(formula=><p key={formula.id}><a href={formula.source.url}>{formula.title}</a> resolves this record's values from its tier and profile. Record adjustments are applied afterward.</p>)}<details><summary>Inspect inputs, parameters and consumers</summary><FormulaWorkspace {...props}/></details></section>;
}
