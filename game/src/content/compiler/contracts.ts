/** Shared content compiler contracts. Domain compilers only consume authored inputs. */
export interface SourceLocation {
  collection: string;
  id: string;
  formula?: string;
  profile?: string;
  inputs?: Record<string, unknown>;
}

export interface ContentDiagnostic {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface CompiledDomain<T> {
  version: 1;
  revision: string;
  tables: T;
  sourceMap: Record<string, SourceLocation>;
}
