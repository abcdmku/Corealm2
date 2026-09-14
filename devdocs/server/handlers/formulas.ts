import path from 'node:path';
import { readFile } from 'node:fs/promises';
import * as registry from '../../../game/src/content/formulas/index.js';
import { repoRoot } from '../../../tools/lib/paths.js';
import type { FormulaBuildStatus, FormulaConsumer, FormulaImpact } from '../../shared/formulas.js';
import { isLoopbackDevdocsRequest, type DevdocsRequest, type DevdocsJsonResponse } from './collections.js';
export interface FormulasHandlerOptions {
  getBuildStatus?: () => FormulaBuildStatus | Promise<FormulaBuildStatus>;
  getConsumers?: () => FormulaConsumer[] | Promise<FormulaConsumer[]>;
  loadRegistry?: () => Promise<typeof registry>;
  previewImpacts?: (request: {formulaId: registry.FormulaId; parameters: unknown; profileId: string}) => Promise<FormulaImpact[]>;
}
export function isFormulasPath(url: string | undefined) { return /^\/__devdocs\/formulas(?:\/preview)?(?:[?#]|$)/.test(url ?? ''); }
const json = (status:number, value:unknown): DevdocsJsonResponse => ({ status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}, body:JSON.stringify(value) });
export function createFormulasHandler(options: FormulasHandlerOptions = {}) {
  return async (request:DevdocsRequest & {body?:unknown}):Promise<DevdocsJsonResponse|undefined> => {
    if (!isFormulasPath(request.url)) return;
    if (!isLoopbackDevdocsRequest(request)) return json(403,{error:'Dev docs API accepts loopback requests only'});
    try {
      const current = options.loadRegistry ? await options.loadRegistry() : registry;
      if (request.url?.split(/[?#]/)[0] === '/__devdocs/formulas/preview') {
        if (request.method !== 'POST') return json(405,{error:'POST required'});
        const body = request.body;
        if (!body || typeof body !== 'object' || !('formulaId' in body) || !current.isFormulaId(body.formulaId) || !('input' in body) || !('parameters' in body)) return json(422,{error:'A registered formula, input and parameters are required.'});
        const formulaId = body.formulaId;
        const result = current.previewFormula(formulaId,body.input,body.parameters);
        const selectedProfile = 'profileId' in body && typeof body.profileId === 'string' ? body.profileId : undefined;
        if (selectedProfile && !options.previewImpacts) return json(503,{error:'Compiled impact preview is unavailable.'});
        const impacts = selectedProfile ? await options.previewImpacts!({formulaId,parameters:body.parameters,profileId:selectedProfile}) : [];
        return json(200,{result,impacts,examples:[1,10,30,50,70].map(tier=>({tier,result:current.previewFormula(formulaId,{tier},body.parameters)}))});
      }
      if (request.method && request.method !== 'GET') return json(405,{error:'GET required'});
      const consumers = await options.getConsumers?.() ?? [];
      const formulas = await Promise.all(Object.entries(current.formulaRegistry).map(async ([id, formula]) => {
        const absolute = path.resolve(repoRoot, formula.source.file);
        const text = await readFile(absolute,'utf8');
        const line = text.split(/\r?\n/).findIndex(value=>value.includes(`function ${formula.source.symbol}(`)) + 1;
        if (!line) throw new Error(`Source function ${formula.source.symbol} could not be found`);
        return {id,title:formula.title,description:formula.description,profilesCollection:formula.profilesCollection,
          source:{...formula.source,line,url:`vscode://file/${absolute.replace(/\\/g,'/')}:${line}:1`},
          defaultInput:formula.defaultInput,defaultParameters:formula.defaultParameters,consumers:consumers.filter(consumer=>consumer.formula===id)};
      }));
      return json(200,{formulas,build:await options.getBuildStatus?.() ?? {state:'idle',diagnostics:[]}});
    } catch(error) { return json(422,{error:error instanceof Error ? error.message : 'Formula calculation failed'}); }
  };
}



