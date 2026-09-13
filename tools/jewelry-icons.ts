/** Reproduce the accepted jewelry masters and derivatives from the durable art registry. */
import { generateItemIcons } from './generate-item-icons.js';
import { CRAFTED_JEWELRY } from '../game/src/content/jewelry.js';
import { MINIBOSS_JEWELLERY } from '../game/src/content/universalMinibossLoot.js';
await generateItemIcons({ all: true, only: [...CRAFTED_JEWELRY, ...MINIBOSS_JEWELLERY].map(item => item.id), out: 'test-results/jewelry-icons' });
