export interface FormulaConsumer { record: string; collection: string; id: string; formula?: string; profile?: string; inputs?: Record<string, unknown>; }
export interface FormulaBuildStatus { state: 'idle' | 'checking' | 'valid' | 'invalid'; revision?: string; diagnostics: {path:string;message:string;severity:'error'|'warning'}[]; }
export interface FormulaDescription { id: string; title: string; description: string; source: {file:string;symbol:string;line:number;url:string}; profilesCollection:string; defaultInput: unknown; defaultParameters: unknown; consumers: FormulaConsumer[]; }
export interface FormulasResponse { formulas: FormulaDescription[]; build: FormulaBuildStatus; }
export interface FormulaPreviewResponse { result: unknown; examples: {tier:number;result:unknown}[]; impacts?: FormulaImpact[]; }


export interface FormulaImpact { record:string; before:unknown; after:unknown; }

