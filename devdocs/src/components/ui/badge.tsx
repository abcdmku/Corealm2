import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

export const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-[11px] font-medium [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        default: "border-border-subtle bg-secondary text-muted-foreground",
        outline: "border-border text-muted-foreground",
        accent: "border-transparent bg-brass-soft text-primary",
        ok: "border-transparent bg-ok-soft text-ok",
        warn: "border-transparent bg-warn-soft text-warn",
        danger: "border-transparent bg-destructive-soft text-destructive",
        info: "border-transparent bg-info-soft text-info",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** A legacy tone name ("accent", "ok", "warn", "danger", "info") or nothing, as a badge variant. */
export function toneVariant(tone: string | undefined | null): BadgeTone {
  return tone === "accent" || tone === "ok" || tone === "warn" || tone === "danger" || tone === "info" || tone === "outline" ? tone : "default";
}
