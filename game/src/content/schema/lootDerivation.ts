import { lit, obj, str } from './core.js';

export const SourceLootDerivationSchema = obj({ kind: lit('sourceLoot.v1'), inputId: str({ nonEmpty: true }) });
