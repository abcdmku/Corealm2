
/*
  The one field model every page migrates to. Import from here, not from the files inside.
  Layout primitives that did not need new markup are re-exported from `Sheet` so a page imports
  one module.
*/

export { Field, FieldLegend, type FieldProps } from "./Field.js";
export { NumberField, type NumberFieldProps, type NumberWidth } from "./NumberField.js";
export { TextField, type TextFieldProps, type TextWidth } from "./TextField.js";
export { ChoiceField, normalizeOptions, type ChoiceFieldProps, type ChoiceOption } from "./ChoiceField.js";
export { ToggleField, type ToggleFieldProps } from "./ToggleField.js";
export { DerivedNumber, DerivedChoice, type DerivedNumberProps, type DerivedChoiceProps } from "./DerivedNumber.js";
export { fieldFromSchema, useField, type SchemaFieldSpec } from "./fromSchema.js";
export { useFieldContext, type FieldContextValue } from "./context.js";
export {
  fieldTransition, stepValue, clampNumber, evaluateNumber, scrubDelta, mixedEdit, parseMixedEdit, applyMixedOp, formatNumber, describeRevert, DOT_LEGEND,
  type FieldPhase, type FieldEvent, type FieldTransition, type NumberRules, type NumberResult, type MixedOp, type MixedParse, type DotState,
} from "./model.js";
export { Section, Fields, Row, Facts, Static, Sheet, Columns } from "../Sheet.js";
export { ListField, type ListFieldProps, type ListItemApi } from "./ListField.js";
export { MapField, type MapFieldProps } from "./MapField.js";
export { WeightedList, type WeightedListProps } from "./WeightedList.js";
export { UnionField, UnionList, SchemaControl, type UnionFieldProps, type UnionListProps, type SchemaControlProps, type RenderRef } from "./UnionField.js";
export { move, shares, redistribute, clampProbability, carryOver, variantSchema, variantTag, type CarryOver } from "./reorder.js";
export { RefField, type RefFieldProps } from "./RefField.js";
export { ReferencedBy, groupReferences, relationshipLabel, parseReferencePath, type ReferencedByProps } from "./ReferencedBy.js";
export { Peek, PeekProvider, usePeek, type PeekTarget } from "../Peek.js";
