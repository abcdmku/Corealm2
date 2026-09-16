/*
  Named Tailwind recipes for page layout, so pages say what a box is (a page, a record, its rail,
  an empty note) instead of repeating a dozen utilities. Components in components/ui cover
  controls; these cover the frames the controls sit in.
*/

export const PAGE = "max-w-[87.5rem] px-4 pt-3 pb-10 max-md:px-2.5";
export const PAGE_WIDE = "max-w-[105rem] px-4 pt-3 pb-8 max-md:px-2.5";
export const PAGE_HEADING = "mb-2.5 flex min-h-6 flex-wrap items-baseline gap-2.5 [&_h1]:text-[15px] [&_h1]:font-semibold [&>.inline-flex]:text-xs";
export const PAGE_ACTIONS = "ml-auto flex items-center gap-1";

/** A record page: the sheet and its context rail. */
/** A rail with nothing in it (a record with no model and no context) gives its column back to the sheet. */
export const RECORD = "grid max-w-[80rem] grid-cols-[minmax(0,1fr)_21rem] items-start gap-6 @max-[58rem]:grid-cols-1 has-[>aside>div:empty:only-child]:grid-cols-1 [&>aside:has(>div:empty:only-child)]:hidden";
export const RECORD_MAIN = "min-w-0";
export const RECORD_RAIL = "sticky top-2 flex min-w-0 flex-col gap-3 @max-[58rem]:static";
export const RECORD_HEAD = "mb-3 flex items-center gap-3 [&_.thumb]:shrink-0";
export const RECORD_TITLE = "flex min-w-0 flex-1 flex-col gap-0.5 [&_h1]:truncate [&_h1]:text-lg [&_h1]:leading-tight [&_h1]:font-semibold [&_code]:text-[11px] [&_code]:text-faint [&>.inline-flex]:text-xs";
export const RECORD_ACTIONS = "flex shrink-0 items-center gap-1";

export const PANEL = "rounded-md border border-border bg-card";
export const PANEL_HEADER = "flex min-h-[30px] items-center gap-2 border-b border-border-subtle px-2.5 py-[5px] [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:text-xs [&_h3]:font-semibold";
export const PANEL_BODY = "px-2.5 py-2";

/** A small uppercase heading over a block in a rail or a list of groups. */
export const BLOCK_TITLE = "text-[11px] font-semibold tracking-[.04em] text-faint uppercase";
export const RAIL_BLOCK = "flex flex-col gap-1.5 [&>h3]:text-[11px] [&>h3]:font-semibold [&>h3]:tracking-[.04em] [&>h3]:text-faint [&>h3]:uppercase";

/** A list page's filter row: search, segmented controls, chips, and a count pushed to the right. */
export const TOOLBAR = "mb-3 flex min-h-7 flex-wrap items-center gap-2";
export const COUNT = "ml-auto font-mono text-[11px] whitespace-nowrap text-faint";
/** A labelled group of rows in a list page (bestiary by region, catalog by tier). */
export const GROUP = "mb-4 flex flex-col gap-1.5 border-t border-border-subtle pt-2 first-of-type:border-t-0 first-of-type:pt-0";

export const EMPTY = "py-1 text-xs text-faint";
export const FACTS = "inline-flex flex-wrap items-center gap-x-1 text-muted-foreground [&>span+span]:before:mr-1 [&>span+span]:before:text-faint [&>span+span]:before:content-['·']";
export const STACK = "flex flex-col gap-0.5";
export const WRAP = "flex flex-wrap items-center gap-1";
