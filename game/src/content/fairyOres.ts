import type { ResourceDef } from './index.js';
import { resourceRows } from './resourceData.js';

/** Regional seams supply the matching T30, T40 and T60 production ladders. */
export const FAIRY_ORE_RESOURCES: readonly ResourceDef[] = resourceRows('FAIRY_ORE_RESOURCES');

/** Local skins keep the native willow/yew logs and the existing gathering and save rules. */
export const FAIRY_TREE_RESOURCES: readonly ResourceDef[] = resourceRows('FAIRY_TREE_RESOURCES');
