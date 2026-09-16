import { useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";

export interface MenuItem { label: string; icon?: ReactNode; onSelect: () => void; tone?: "danger"; disabled?: boolean; separator?: boolean }

/** A compact action menu: keeps rarely used record actions one click away without a row of buttons. */
export function Menu({ trigger, items, align = "end" }: { trigger: ReactNode; items: readonly MenuItem[]; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="z-[60] min-w-44 rounded-md border border-border bg-popover p-[3px] shadow-lg shadow-shadow" align={align} sideOffset={6} collisionPadding={12}>
        {items.map((item, index) => <div key={index}>
          {item.separator && index > 0 && <hr className="my-[3px] border-0 border-t border-border-subtle" />}
          <button type="button" className={`flex h-7 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-xs hover:bg-accent disabled:cursor-default disabled:opacity-50 [&_svg]:size-3.5 ${item.tone === "danger" ? "text-destructive" : ""}`} data-tone={item.tone} disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect(); }}>{item.icon}{item.label}</button>
        </div>)}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
