import raw from '../../content/data/balance/loot.json';
import { lootBalanceSchema } from './schema/balance.js';
import { parseValue } from './schema/core.js';

export const LOOT_BALANCE = parseValue(lootBalanceSchema, raw, 'balance/loot');
