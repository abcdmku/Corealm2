import type { ArmorTheme } from './contracts.js';

/** Equipment IDs retain their progression; R13 exchanges the complete authored looks. */
export function designForTier(itemTheme: ArmorTheme): ArmorTheme {
  return itemTheme === 'dragonhide' ? 'starhide' : 'dragonhide';
}
