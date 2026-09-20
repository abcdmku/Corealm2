import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleUser, LogOut, ShieldCheck } from "lucide-react";
import { banPlayer, failureMessage, kickPlayer, liftBan, listPlayers, playerQuery, type PlayerDetail, type PlayerSummary } from "../../api/adminData.js";
import { Badge, Button, Input, SearchInput, Segmented } from "../../components/ui/index.js";
import { ActionError, ConfirmAction } from "../../ui/Confirm.js";
import { AuditList } from "../../ui/AuditList.js";
import { Facts, Row, Section, Sheet, Static } from "../../ui/field/index.js";
import { ListRow } from "../../ui/ListRow.js";
import { EmptyNote, EmptyState, ErrorState, LoadingRows } from "../../ui/States.js";
import { Thumb } from "../../ui/Thumb.js";
import { PAGE, RECORD_ACTIONS, RECORD_HEAD, RECORD_TITLE } from "../../ui/layout.js";
import { duration, moment, since } from "../../model/format.js";
import { cn } from "../../lib/utils.js";
import type { ViewProps } from "../types.js";
import { PlayerSheet } from "./PlayerSheet.js";
import { AccountCode, BanBadge, OnlineBadge, OnlineDot, worldLabel } from "./shared.js";

/**
 * Every account this server has seen, and what an admin may do to one.
 *
 * The rail on the left is the whole population, searched and paged from `GET /admin/players`; the
 * record beside it is one player's private state, which is read from the world holding them when
 * they are online, so it is what they are carrying right now rather than what the last commit wrote.
 * Kick and ban leave this page and land on a person, so both go through a confirm that says so.
 */

export default function PlayersView({ recordId, navigate }: ViewProps) {
  const open = (accountId: string) => navigate("players/players", accountId);
  // One column on a phone: the rail is the page until a player is chosen, then the record is.
  return <div className="grid h-full min-h-0 flex-1 grid-cols-[17rem_minmax(0,1fr)] bg-background max-lg:grid-cols-[14rem_minmax(0,1fr)] max-md:grid-cols-1">
    <PlayerRail selected={recordId} onPick={open} className={cn(recordId && "max-md:hidden")} />
    <div className={cn("@container min-h-0 min-w-0 overflow-y-auto", !recordId && "max-md:hidden")} data-record-id={recordId}>
      {recordId ? <PlayerPage key={recordId} accountId={recordId} /> : <NoPlayerChosen />}
    </div>
  </div>;
}

function NoPlayerChosen() {
  return <div className={PAGE}><EmptyState title="Choose a player">
    Search the list for a name or an account id. A player who is online is read from the world holding them.
  </EmptyState></div>;
}

// ----------------------------------------------------------------------- rail

function PlayerRail({ selected, onPick, className }: { selected: string | undefined; onPick: (accountId: string) => void; className?: string }) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const timer = setTimeout(() => setDebounced(text.trim()), 250); return () => clearTimeout(timer); }, [text]);

  const query = useInfiniteQuery({
    queryKey: ["admin", "players", debounced],
    queryFn: ({ pageParam, signal }) => listPlayers(debounced, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.cursor ?? undefined,
    staleTime: 2_000, retry: false,
  });
  const players = useMemo(() => query.data?.pages.flatMap(page => page.players) ?? [], [query.data]);

  return <aside className={cn("flex min-h-0 flex-col gap-1.5 border-r border-border bg-sidebar p-2", className)} aria-label="Players">
    <SearchInput value={text} onChange={setText} label="Search players" placeholder="Name or account id" shortcut className="w-full"
      onEnter={() => { const first = players[0]; if (first) onPick(first.accountId); }} />
    <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState message={query.error.message} retry={() => void query.refetch()} />}
      {query.isSuccess && !players.length && <EmptyNote>{debounced ? "Nobody matches that." : "No account has played here yet."}</EmptyNote>}
      {players.map(player => <PlayerRow key={player.accountId} player={player} selected={player.accountId === selected} onPick={() => onPick(player.accountId)} />)}
      {query.hasNextPage && <Button variant="ghost" size="sm" className="mt-1 self-start" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
        {query.isFetchingNextPage ? "Loading…" : "Load more"}
      </Button>}
    </div>
  </aside>;
}

function PlayerRow({ player, selected, onPick }: { player: PlayerSummary; selected: boolean; onPick: () => void }) {
  return <ListRow className={cn(selected && "border-border bg-selected")} aria-current={selected ? "true" : undefined} hint={player.accountId}
    art={<span className="flex w-4 shrink-0 justify-center"><OnlineDot world={player.online} /></span>}
    title={player.name}
    subtitle={player.online ? `In ${player.online.worldId}` : `Seen ${since(player.lastSeen)}`}
    meta={player.ban ? <Badge variant="danger" className="h-4 px-1">ban</Badge> : undefined}
    onClick={onPick} />;
}

// --------------------------------------------------------------------- record

function PlayerPage({ accountId }: { accountId: string }) {
  const query = useQuery(playerQuery(accountId));
  const [tab, setTab] = useState<"character" | "audit">("character");
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "player", accountId] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "players"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  };

  if (query.isPending) return <div className={PAGE}><LoadingRows /></div>;
  if (query.isError) return <div className={PAGE}><ErrorState message={failureMessage(query.error)} retry={() => void query.refetch()} /></div>;
  const player = query.data;

  return <div className={PAGE}>
    <div className={RECORD_HEAD}>
      <Thumb spec={{ kind: "glyph", icon: CircleUser, letter: player.name.slice(0, 2).toUpperCase() }} size="l" alt="" />
      <div className={RECORD_TITLE}>
        <h1>{player.name}</h1>
        <AccountCode accountId={player.accountId} />
      </div>
      <div className={RECORD_ACTIONS}><OnlineBadge player={player} /><BanBadge player={player} /><PlayerActions player={player} onDone={refresh} /></div>
    </div>

    <Segmented className="mb-3" aria-label="Player views">
      <Button variant="segment" size="sm" aria-pressed={tab === "character"} onClick={() => setTab("character")}>Character</Button>
      <Button variant="segment" size="sm" aria-pressed={tab === "audit"} onClick={() => setTab("audit")}>Audit</Button>
    </Segmented>

    {tab === "character"
      ? <>
        <Sheet className="mb-3">
          <Section title="Identity">
            <Row label="First seen"><Static title={moment(player.firstSeen)}>{since(player.firstSeen)}</Static></Row>
            <Row label="Last seen"><Static title={moment(player.lastSeen)}>{player.online ? "Playing now" : since(player.lastSeen)}</Static></Row>
            <Row label="Playtime"><Static>{duration(player.playtimeSeconds)}</Static></Row>
            <Row label="Last world"><Static mono>{worldLabel(player.lastWorld)}</Static></Row>
            <Row label="Standing"><Facts items={[
              player.regionId ?? "no region",
              player.position ? player.position.map(value => Math.round(value)).join(", ") : "no position",
            ]} /></Row>
            {player.ban && <Row label="Ban"><Static className="text-destructive">{player.ban.reason}</Static></Row>}
          </Section>
        </Sheet>
        {player.revision === null
          ? <EmptyNote>This account holds a role or a ban here but has never played, so there is no character to edit.</EmptyNote>
          : <PlayerSheet player={player} onApplied={refresh} />}
      </>
      : <AuditList filter={{ target: player.accountId }} showTarget={false} nameOf={id => id === player.accountId ? player.name : undefined}
        emptyNote={`Nothing has been done to ${player.name} yet.`} />}
  </div>;
}

// -------------------------------------------------------------------- actions

function PlayerActions({ player, onDone }: { player: PlayerDetail; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState("");

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setError("");
    try { await work(); onDone(); } catch (failure) { setError(failureMessage(failure)); }
  };

  return <div className="flex flex-col items-end gap-1">
    <div className="flex items-center gap-1">
      <ConfirmAction label="Kick" icon={<LogOut />} size="sm" disabled={!player.online} disabledReason="Only a connected player can be kicked."
        consequence={<>{player.name} is disconnected from {player.online?.worldId ?? "their world"} at once. Their character is saved and they may join again immediately.</>}
        confirmLabel="Kick" onConfirm={() => run(() => kickPlayer(player.accountId, reason))} onOpenChange={open => { if (open) setReason(""); }}>
        <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          Reason, shown to them (optional)
          <Input value={reason} onChange={event => setReason(event.target.value)} placeholder="Taking the world down for a publish" maxLength={512} />
        </label>
      </ConfirmAction>

      {player.ban
        ? <ConfirmAction label="Lift ban" icon={<ShieldCheck />} variant="secondary" size="sm"
          consequence={<>{player.name} may join and sign in again from now on. The ban stays in the audit log.</>}
          confirmLabel="Lift the ban" onConfirm={() => run(() => liftBan(player.accountId))} />
        : <ConfirmAction label="Ban" icon={<Ban />} size="sm"
          consequence={<>{player.name} is refused at every join and every admin sign-in{player.online ? ", and is disconnected now" : ""}. An owner cannot be banned.</>}
          confirmLabel="Ban this account" confirmDisabled={!reason.trim()} confirmDisabledReason="A ban needs a reason."
          onConfirm={() => run(() => banPlayer(player.accountId, reason.trim(), expiry ? new Date(expiry).getTime() : null))}
          onOpenChange={open => { if (open) { setReason(""); setExpiry(""); } }}>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Reason, shown to them
            <Input value={reason} onChange={event => setReason(event.target.value)} placeholder="Repeated harassment in chat" maxLength={512} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            Expires (leave empty for no expiry)
            <Input type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} />
          </label>
        </ConfirmAction>}
    </div>
    <ActionError message={error} />
  </div>;
}
