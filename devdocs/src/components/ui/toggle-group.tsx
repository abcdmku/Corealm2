import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "../../lib/utils.js";

/* A segmented control (Grid / List / Table, group-by). Arrow keys move between items. */
export function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return <ToggleGroupPrimitive.Root data-slot="toggle-group" className={cn("inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-card p-0.5", className)} {...props} />;
}

export function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return <ToggleGroupPrimitive.Item data-slot="toggle-group-item" className={cn(
    "inline-flex h-full cursor-pointer items-center gap-1 rounded-sm px-2 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 data-[state=on]:bg-selected data-[state=on]:font-medium data-[state=on]:text-foreground [&_svg:not([class*='size-'])]:size-3.5",
    className,
  )} {...props} />;
}
