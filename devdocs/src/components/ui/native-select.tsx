import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { inputBase } from "./input.js";

/*
  shadcn's NativeSelect: a real <select> styled like the inputs. Kept native on purpose — type-ahead,
  arrow keys, Space and the OS list are faster for a keyboard author than a custom listbox.
*/
export function NativeSelect({ className, wrapperClassName, ...props }: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return <span data-slot="native-select" className={cn("relative inline-flex w-fit min-w-0 max-w-full", wrapperClassName)}>
    <select className={cn(inputBase, "w-full cursor-pointer appearance-none truncate pr-7", className)} {...props} />
    <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-faint" />
  </span>;
}
