import { useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { LoaderCircle } from "lucide-react";
import { Button, type ButtonProps } from "../components/ui/index.js";
import { cn } from "../lib/utils.js";

/**
 * The step in front of anything that reaches outside this page: a kick, a ban, a revoked token, a
 * role change, a rollback. It says in one sentence what will happen and to whom, so nobody learns
 * what a button does by pressing it. Fields the action needs (a reason, an expiry) go in `children`
 * and are part of the same step rather than a separate form somewhere else.
 */
export function ConfirmAction({ label, icon, variant = "destructive", size = "sm", consequence, confirmLabel, disabled, disabledReason, confirmDisabled, confirmDisabledReason, busy, children, onConfirm, onOpenChange, className }: {
  label: ReactNode;
  icon?: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** One sentence naming the effect and who it lands on. */
  consequence: ReactNode;
  confirmLabel: string;
  disabled?: boolean;
  /** Why the action is unavailable, shown as the button's tooltip rather than hiding it. */
  disabledReason?: string;
  /** The confirm button only: the step is open, but a field it needs is still empty. */
  confirmDisabled?: boolean;
  confirmDisabledReason?: string;
  busy?: boolean;
  children?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const change = (next: boolean) => { setOpen(next); onOpenChange?.(next); };
  const working = running || busy === true;
  return <Popover.Root open={open} onOpenChange={change}>
    <Popover.Trigger asChild>
      <Button variant={variant} size={size} disabled={disabled} title={disabled ? disabledReason : undefined} className={className}>{icon}{label}</Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content align="end" sideOffset={6} collisionPadding={12}
        className="popover z-[60] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2.5 rounded-md border border-border bg-popover p-2.5 shadow-xl shadow-shadow">
        <p className="text-xs leading-relaxed text-foreground">{consequence}</p>
        {children}
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => change(false)}>Cancel</Button>
          <Button variant={variant === "destructive" ? "destructive" : "default"} size="sm" disabled={working || confirmDisabled} title={confirmDisabled ? confirmDisabledReason : undefined} onClick={() => {
            setRunning(true);
            void Promise.resolve(onConfirm()).finally(() => { setRunning(false); change(false); });
          }}>{working && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}{confirmLabel}</Button>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

/** A one-line failure under the control that caused it. */
export function ActionError({ message, className }: { message: string; className?: string }) {
  if (!message) return null;
  return <p role="alert" className={cn("text-[11px] leading-relaxed text-destructive [overflow-wrap:anywhere]", className)}>{message}</p>;
}
