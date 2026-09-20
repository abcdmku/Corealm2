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
  /** `info` reports what the compiler did on the author's behalf, such as taking a retired item out of a loot roll. */
  severity: 'error' | 'warning' | 'info';
}

export interface CompiledDomain<T> {
  version: 1;
  revision: string;
  tables: T;
  sourceMap: Record<string, SourceLocation>;
}
