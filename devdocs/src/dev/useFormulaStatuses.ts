import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formulasQuery } from './formulas/FormulaWorkspace.js';
import { type FormulaStatus } from '../model/formulaStatus.js';
export { FORMULA_STATUS_LABELS, type FormulaStatus } from '../model/formulaStatus.js';
export type FormulaStatusMap = ReadonlyMap<string, FormulaStatus>;
export interface FormulaStatusesResult { statuses:FormulaStatusMap;loading:boolean;error:Error|undefined; }
export function useFormulaStatuses(collection:string,rawRows:readonly Record<string,unknown>[],enabled:boolean):FormulaStatusesResult {
  const query=useQuery({...formulasQuery,enabled});
  return useMemo(()=>{
    const statuses=new Map<string,FormulaStatus>();
    if(enabled)for(const row of rawRows){const id=String(row.id ?? '');const generated=query.data?.formulas.some(formula=>formula.consumers.some(consumer=>consumer.record===`${collection}:${id}`));statuses.set(id,query.isPending?'loading':query.isError?'error':generated?'compiled':'authored');}
    return {statuses,loading:enabled&&query.isPending,error:query.error ?? undefined};
  },[collection,rawRows,enabled,query.data,query.isPending,query.isError,query.error]);
}
