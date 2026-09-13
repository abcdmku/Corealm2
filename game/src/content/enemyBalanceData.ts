import raw from '../../content/data/balance/enemies.json';
import { EnemyBalanceSchema } from './schema/enemyBalance.js';
import { parseValue } from './schema/core.js';

export const ENEMY_BALANCE = parseValue(EnemyBalanceSchema, raw, 'balance/enemies');
