import { createContext, useContext, type PointerEvent as ReactPointerEvent } from "react";

/*
  What a control inside a `Field` can tell its wrapper: whether it is editing (so Backspace reverts
  only while it is not), a parse error to show under the control, and pointer handlers the wrapper
  attaches to its label so Alt+drag scrubs the number. A control rendered outside a `Field` gets the
  no-op defaults and works on its own.
*/

export interface LabelHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface FieldContextValue {
  /** The id of the label element, for `aria-labelledby` on the control. */
  labelId?: string;
  compact: boolean;
  disabled: boolean;
  setEditing: (editing: boolean) => void;
  reportError: (message: string | undefined) => void;
  setLabelHandlers: (handlers: LabelHandlers | null) => void;
  setScrubbing: (scrubbing: boolean) => void;
}

const noop = (): void => {};

export const FieldContext = createContext<FieldContextValue>({
  compact: false, disabled: false, setEditing: noop, reportError: noop, setLabelHandlers: noop, setScrubbing: noop,
});

export const useFieldContext = (): FieldContextValue => useContext(FieldContext);
