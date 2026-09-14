import { useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";

export interface MenuItem { label: string; icon?: ReactNode; onSelect: () => void; tone?: "danger"; disabled?: boolean; separator?: boolean }

/** A compact action menu: keeps rarely used record actions one click away without a row of buttons. */
export function Menu({ trigger, items, align = "end" }: { trigger: ReactNode; items: readonly MenuItem[]; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="menu" align={align} sideOffset={6} collisionPadding={12}>
        {items.map((item, index) => <div key={index}>
          {item.separator && index > 0 && <hr />}
          <button type="button" data-tone={item.tone} disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect(); }}>{item.icon}{item.label}</button>
        </div>)}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
