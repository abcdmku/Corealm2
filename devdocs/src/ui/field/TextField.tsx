import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input, Textarea } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { useFieldContext } from "./context.js";

/*
  Text with the same commit model as `NumberField`: Enter commits a single line (Ctrl+Enter a
  multiline one, where Enter is a newline), blur commits, Escape restores the pre-edit text.
*/

export type TextWidth = "short" | "id" | "text" | "full";

export interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  multiline?: boolean;
  /** `short` 160px, `id` 220px mono, `text` up to 360px (default), `full` fills the row. */
  width?: TextWidth;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
}

export function TextField({ value, onChange, mono = false, multiline: asked = false, width = "text", placeholder, disabled, readOnly, ariaLabel, autoFocus, className = "" }: TextFieldProps) {
  const field = useFieldContext();
  // Prose (a description, an unlock line) edits in a box that shows all of it. Decided once, so a value
  // growing past the threshold while typing does not swap the control under the caret.
  const [multiline] = useState(() => asked || (!mono && width !== "id" && width !== "short" && value.length > 64));
  const [text, setText] = useState(value);
  const [editing, setEditingState] = useState(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const inert = disabled || readOnly || field.disabled;
  const setEditing = (next: boolean) => { setEditingState(next); field.setEditing(next); };

  useEffect(() => { if (!editing) setText(value); }, [value, editing]);

  const commit = () => { if (text !== value) onChange(text); setEditing(false); };
  const restore = () => { setText(value); setEditing(false); };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (inert) return;
    if (event.key === "Enter" && (!multiline || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (editing) commit();
    } else if (event.key === "Escape" && editing) {
      event.preventDefault();
      restore();
    }
  };

  const shared = {
    ref, value: text, placeholder, disabled: disabled || field.disabled, readOnly, autoFocus,
    "aria-label": ariaLabel, "aria-labelledby": ariaLabel ? undefined : field.labelId, spellCheck: multiline,
    onChange: (event: { target: { value: string } }) => { if (inert) return; setText(event.target.value); if (!editing) setEditing(true); },
    onKeyDown,
    onFocus: (event: { target: HTMLInputElement | HTMLTextAreaElement }) => { if (!multiline) event.target.select(); },
    onBlur: () => { if (editing) commit(); },
  };

  if (multiline) {
    return <Textarea {...shared} className={cn("field-input field-textarea resize-y", width === "text" ? "w-[44rem] max-w-full" : WIDTH[width], mono && "font-mono", className)} data-kind="text" data-disabled={inert || undefined} data-editing={editing || undefined}
      rows={Math.min(8, Math.max(2, text.split("\n").length))} />;
  }
  return <Input {...shared} className={cn("field-input", WIDTH[width], (mono || width === "id") && "font-mono", className)} data-kind="text" data-width={width} data-disabled={inert || undefined} data-editing={editing || undefined} autoComplete="off" />;
}

const WIDTH: Readonly<Record<TextWidth, string>> = { short: "w-40", id: "w-auto min-w-56 max-w-full field-sizing-content", text: "w-[22.5rem] max-w-full", full: "w-full" };
