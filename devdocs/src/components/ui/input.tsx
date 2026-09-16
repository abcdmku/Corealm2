import * as React from "react";
import { cn } from "../../lib/utils.js";

/*
  Text inputs and the input group (shadcn's InputGroup): a bordered box that holds a borderless
  input plus addons — a unit ("ms"), a search icon, a clear button — and takes the focus ring as a
  whole. Every text and number control in the app is one of these.
*/

export const inputBase = "h-7 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-xs text-foreground shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-faint focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" type={type} className={cn(inputBase, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(inputBase, "h-auto min-h-14 py-1.5 leading-relaxed", className)} {...props} />;
}

export function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="input-group" role="group" className={cn(
    "flex h-7 w-full min-w-0 items-center rounded-md border border-input bg-background text-xs shadow-xs transition-[border-color,box-shadow]",
    "has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring/25",
    "has-[[aria-invalid=true]]:border-destructive has-[input:disabled]:opacity-50",
    className,
  )} {...props} />;
}

export function InputGroupInput({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input-group-control" className={cn("h-full w-full min-w-0 flex-1 bg-transparent px-2.5 text-xs text-foreground outline-none placeholder:text-faint disabled:cursor-not-allowed", className)} {...props} />;
}

export function InputGroupAddon({ className, align = "end", ...props }: React.ComponentProps<"span"> & { align?: "start" | "end" }) {
  return <span data-slot="input-group-addon" data-align={align} className={cn("flex h-full shrink-0 items-center gap-1 text-[11px] text-faint [&_svg:not([class*='size-'])]:size-3.5", align === "start" ? "order-first pl-2.5" : "pr-2.5", className)} {...props} />;
}
