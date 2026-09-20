import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { WorldKey } from "../../../../game/src/contracts.js";
import type { PlayerSummary } from "../../api/adminData.js";
import { Badge, Button } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";

/*
  The chips every player list and player header repeats, and the one control that makes an account
  id useful: a copy button, because it is the key every other admin surface is searched by.
*/

export const worldLabel = (world: WorldKey | null | undefined): string => world ? world.worldId : "—";

/** The account id, readable and copyable. */
export function AccountCode({ accountId, className }: { accountId: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
    <code className="truncate font-mono text-[11px] text-muted-foreground">{accountId}</code>
    <Button variant="ghost" size="icon-xs" aria-label={copied ? "Account id copied" : "Copy account id"} title={copied ? "Copied" : "Copy account id"}
      onClick={() => { void navigator.clipboard?.writeText(accountId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1_500); }, () => {}); }}>
      {copied ? <Check /> : <Copy />}
    </Button>
  </span>;
}

/** Green while a world holds this account, with the world's name in it. */
export function OnlineBadge({ player }: { player: Pick<PlayerSummary, "online"> }) {
  if (!player.online) return <Badge variant="default" title="No world holds this account">Offline</Badge>;
  return <Badge variant="ok" title={`Playing in ${player.online.worldId}`}>
    <span aria-hidden className="size-1.5 rounded-full bg-current" />{player.online.worldId}
  </Badge>;
}

export function BanBadge({ player }: { player: Pick<PlayerSummary, "ban"> }) {
  if (!player.ban) return null;
  const until = player.ban.expiresAt === null ? "no expiry" : `until ${new Date(player.ban.expiresAt).toLocaleString()}`;
  return <Badge variant="danger" title={`${player.ban.reason} (${until})`}>Banned</Badge>;
}

/** The dot the rail uses where a badge would be too wide. */
export function OnlineDot({ world }: { world: WorldKey | null }) {
  return <span aria-label={world ? `Online in ${world.worldId}` : "Offline"} title={world ? `Online in ${world.worldId}` : "Offline"}
    className={cn("size-2 shrink-0 rounded-full", world ? "bg-ok" : "bg-border")} />;
}
