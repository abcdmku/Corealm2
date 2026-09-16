import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

/*
  The one button. Sized for a dense editor: 28px default, 24px small, 20px extra-small. `link` is the
  inline text action ("Detach from Heath Jack"); `chip` is a toggleable filter pill that reads its
  state from aria-pressed; `ghost` shows its pressed state the same way.
*/
export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-[color,background-color,border-color,box-shadow] outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:brightness-110",
        secondary: "border border-border bg-secondary text-secondary-foreground shadow-xs hover:bg-accent",
        outline: "border border-input bg-background text-foreground shadow-xs hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground aria-[pressed=true]:bg-selected aria-[pressed=true]:text-primary",
        destructive: "border border-border bg-secondary text-destructive shadow-xs hover:border-destructive hover:bg-destructive-soft",
        link: "text-link underline-offset-2 hover:underline focus-visible:underline focus-visible:ring-0",
        segment: "h-full rounded-sm text-muted-foreground hover:text-foreground aria-[pressed=true]:bg-selected aria-[pressed=true]:text-foreground",
        chip: "rounded-full border border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground aria-[pressed=true]:border-primary aria-[pressed=true]:bg-brass-soft aria-[pressed=true]:text-primary",
      },
      size: {
        default: "h-7 px-3",
        sm: "h-6 px-2",
        xs: "h-5 gap-1 px-1.5 text-[11px]",
        icon: "size-7",
        "icon-sm": "size-6",
        "icon-xs": "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        inline: "h-auto p-0",
      },
    },
    compoundVariants: [{ variant: "link", size: ["default", "sm", "xs"], class: "h-auto px-0" }],
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export interface ButtonProps extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" type={asChild ? undefined : type ?? "button"} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
