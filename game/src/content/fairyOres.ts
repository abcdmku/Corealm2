import type { ResourceDef } from './index.js';
import { RESOURCE_DATA } from './resourceData.js';

/** Regional seams supply the matching T30, T40 and T60 production ladders. */
export const FAIRY_ORE_RESOURCES: readonly ResourceDef[] = RESOURCE_DATA.filter(resource => resource.archetype === "ore" && [30,40,60].includes(resource.tier));

/** Local skins keep the native willow/yew logs and the existing gathering and save rules. */
export const FAIRY_TREE_RESOURCES: readonly ResourceDef[] = RESOURCE_DATA.filter(resource => resource.id === "tree_gloam_willow" || resource.id === "tree_fae_yew");
