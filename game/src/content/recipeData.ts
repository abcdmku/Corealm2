import type { RecipeDef } from './index.js';
import { COMPILED_PROGRESSION } from './compiler/runtime.js';
export const RECIPE_RECORDS = COMPILED_PROGRESSION.recipes;
export const RECIPE_DATA: readonly RecipeDef[] = RECIPE_RECORDS;

