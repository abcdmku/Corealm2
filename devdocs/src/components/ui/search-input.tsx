import { Search, X } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { Button } from "./button.js";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input.js";
import { Kbd } from "./misc.js";

/*
  The one list search box: magnifier, input, clear button (or the "/" hint while empty). Enter runs
  `onEnter` (open the first match) and Escape clears, so a list is search → Enter → record with the
  hands on the keyboard.
*/
export function SearchInput({ value, onChange, label, placeholder, onEnter, shortcut = false, className }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  onEnter?: () => void;
  /** Show the "/" key while the box is empty (the page's primary search). */
  shortcut?: boolean;
  className?: string;
}) {
  return <InputGroup className={cn("w-60", className)}>
    <InputGroupAddon align="start"><Search /></InputGroupAddon>
    <InputGroupInput aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        if (event.key === "Enter" && onEnter) { event.preventDefault(); onEnter(); }
        if (event.key === "Escape" && value) { event.preventDefault(); event.stopPropagation(); onChange(""); }
      }} />
    {value
      ? <Button variant="ghost" size="icon-xs" className="mr-0.5" aria-label="Clear search" onClick={() => onChange("")}><X /></Button>
      : shortcut && <InputGroupAddon><Kbd>/</Kbd></InputGroupAddon>}
  </InputGroup>;
}
