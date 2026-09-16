import * as React from "react";
import { cn } from "../../lib/utils.js";

/*
  A segmented control: a row of `<Button variant="segment" aria-pressed>` in one bordered group
  (Grid / List / Table, group by, Icons / Numbers). Kept as buttons rather than a radio group so each
  segment keeps its own click and title, and a page can put an icon-only segment beside a word.
*/
export function Segmented({ className, ...props }: React.ComponentProps<"div">) {
  return <div role="group" data-slot="segmented" className={cn("inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-card p-0.5", className)} {...props} />;
}
