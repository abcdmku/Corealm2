import { cva, type VariantProps } from "class-variance-authority";

/*
  A record reference as a control: thumbnail, name, optional detail ("×2"). It is the same height,
  radius, border and focus ring as an input so a row of a select, a number and a reference lines up.
  `empty` reads as a picker ("Choose location…"), `missing` as a broken link.
*/
export const chipVariants = cva(
  "ref-chip inline-flex h-7 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md border bg-background pr-2.5 pl-1 text-left text-xs shadow-xs outline-none transition-[border-color,background-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 [&>span]:truncate [&_small]:font-mono [&_small]:text-[11px] [&_small]:text-faint [&_.thumb]:size-5 [&_.thumb]:rounded-sm",
  {
    variants: {
      state: {
        link: "border-input text-link hover:border-link hover:bg-link-soft",
        option: "border-input text-foreground hover:bg-accent",
        empty: "is-empty min-w-40 justify-between border-input pl-2.5 text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5 [&_svg]:text-faint",
        missing: "is-missing border-dashed border-destructive text-destructive hover:bg-destructive-soft",
      },
      size: { default: "", sm: "h-6 text-xs", lg: "h-8 pr-3" },
    },
    defaultVariants: { state: "link", size: "default" },
  },
);

export type ChipState = NonNullable<VariantProps<typeof chipVariants>["state"]>;
