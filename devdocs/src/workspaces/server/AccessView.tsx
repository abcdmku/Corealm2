import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, LoaderCircle, Trash2, UserPlus } from "lucide-react";
import {
  API_SCOPES, SCOPE_HELP, createToken, failureMessage, grantAdmin, revokeRole, revokeToken, rolesQuery, tokensQuery,
  type ApiScope, type ApiTokenRecord, type RoleRecord,
} from "../../api/adminData.js";
import { readSession } from "../../api/session.js";
import { Badge, Button, ChoiceChips, Input, Table, TableBody, TableCell, TableFrame, TableHead, TableHeader, TableRow } from "../../components/ui/index.js";
import { ActionError, ConfirmAction } from "../../ui/Confirm.js";
import { EmptyNote, ErrorState, LoadingRows } from "../../ui/States.js";
import { moment, since } from "../../model/format.js";
import { PAGE, PAGE_HEADING, PANEL, PANEL_BODY, PANEL_HEADER } from "../../ui/layout.js";
import { cn } from "../../lib/utils.js";

/**
 * Who may administer this server, and what automation may do without a person.
 *
 * Roles are owner-only work: an admin sees the list and is told why the controls are not theirs
 * rather than having them hidden. The last owner cannot be removed and an owner cannot be demoted;
 * both refusals come from the API and are shown as they arrive. An API token's secret exists once,
 * in the reply that creates it, which is why the panel that shows it says so plainly.
 */

const ACCOUNT_ID = /^acc_[A-Za-z0-9_-]{22,120}$/;

export default function AccessView() {
  const session = readSession();
  const isOwner = session?.role === "owner";
  return <div className={PAGE}>
    <div className={PAGE_HEADING}>
      <h1>Access</h1>
      <Badge variant={isOwner ? "accent" : "default"}>Signed in as {session?.role ?? "admin"}</Badge>
    </div>
    <div className="flex flex-col gap-4">
      <Roles isOwner={isOwner} selfAccount={session?.accountId ?? ""} />
      <Tokens />
    </div>
  </div>;
}

// ---------------------------------------------------------------------- roles

function Roles({ isOwner, selfAccount }: { isOwner: boolean; selfAccount: string }) {
  const query = useQuery(rolesQuery());
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState("");
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] }); void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] }); };
  const run = async (work: () => Promise<unknown>) => {
    setError("");
    try { await work(); refresh(); } catch (failure) { setError(failureMessage(failure)); }
  };
  const roles = query.data?.roles ?? [];
  const owners = roles.filter(role => role.role === "owner").length;
  const ownerOnly = "Only an owner grants or removes a role.";

  return <section className={PANEL}>
    <div className={PANEL_HEADER}>
      <h2>Roles</h2>
      <span className="ml-auto text-[11px] text-faint">{roles.length} {roles.length === 1 ? "holder" : "holders"}</span>
    </div>
    <div className={cn(PANEL_BODY, "flex flex-col gap-2")}>
      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState message={query.error.message} retry={() => void query.refetch()} />}
      {query.isSuccess && !roles.length && <EmptyNote>Nobody holds a role here yet.</EmptyNote>}
      {Boolean(roles.length) && <TableFrame className="w-full">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Account</TableHead><TableHead>Role</TableHead><TableHead>Granted</TableHead><TableHead>By</TableHead><TableHead aria-label="Actions" />
          </TableRow></TableHeader>
          <TableBody>{roles.map(role => <RoleRow key={role.accountId} role={role} isOwner={isOwner} owners={owners} selfAccount={selfAccount}
            ownerOnly={ownerOnly} onRevoke={() => run(() => revokeRole(role.accountId))} />)}</TableBody>
        </Table>
      </TableFrame>}

      <div className="flex flex-wrap items-center gap-1.5">
        <label className="text-xs text-muted-foreground" htmlFor="grant-account">Grant admin to</label>
        <Input id="grant-account" className="w-72 font-mono" value={accountId} spellCheck={false} disabled={!isOwner}
          placeholder="acc_9Qr7v2KpLd3XmB1sYwTgHa" onChange={event => setAccountId(event.target.value.trim())} />
        <ConfirmAction label="Grant admin" icon={<UserPlus />} variant="secondary" size="sm"
          disabled={!isOwner || !ACCOUNT_ID.test(accountId)}
          disabledReason={isOwner ? "Paste the account id, which starts acc_." : ownerOnly}
          consequence={<>That account may sign in to this admin UI and do everything an admin can: edit, kick and ban players, publish content and change settings.</>}
          confirmLabel="Grant admin" onConfirm={() => run(async () => { await grantAdmin(accountId); setAccountId(""); })} />
      </div>
      <p className="text-[11px] text-faint">A role is keyed by account id. Find one on a player's record, or ask them for it.</p>
      <ActionError message={error} />
    </div>
  </section>;
}

function RoleRow({ role, isOwner, owners, selfAccount, ownerOnly, onRevoke }: {
  role: RoleRecord; isOwner: boolean; owners: number; selfAccount: string; ownerOnly: string; onRevoke: () => Promise<void>;
}) {
  const lastOwner = role.role === "owner" && owners <= 1;
  const otherOwner = role.role === "owner" && role.accountId !== selfAccount;
  const reason = !isOwner ? ownerOnly : lastOwner ? "The last owner cannot be removed." : otherOwner ? "An owner cannot be demoted." : undefined;
  return <TableRow>
    <TableCell><code className="font-mono text-[11px]">{role.accountId}</code>{role.name && <span className="ml-1.5 text-muted-foreground">{role.name}</span>}</TableCell>
    <TableCell><Badge variant={role.role === "owner" ? "accent" : "info"}>{role.role}</Badge></TableCell>
    <TableCell title={moment(role.grantedAt)}>{since(role.grantedAt)}</TableCell>
    <TableCell className="max-w-40 truncate" title={role.grantedBy ?? undefined}>{role.grantedBy ?? <span className="text-faint">—</span>}</TableCell>
    <TableCell className="text-right">
      <ConfirmAction label="Remove" icon={<Trash2 />} size="xs" disabled={Boolean(reason)} disabledReason={reason}
        consequence={<>{role.accountId} loses its role here at once and any admin session it holds stops working. It keeps its character and may still play.</>}
        confirmLabel="Remove the role" onConfirm={onRevoke} />
    </TableCell>
  </TableRow>;
}

// --------------------------------------------------------------------- tokens

function Tokens() {
  const query = useQuery(tokensQuery());
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["content:read"]);
  const [expiry, setExpiry] = useState("");
  const [secret, setSecret] = useState<{ token: string; record: ApiTokenRecord }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["admin", "tokens"] }); void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] }); };
  const tokens = query.data?.tokens ?? [];

  async function create(): Promise<void> {
    setBusy(true); setError("");
    try {
      const { token, ...record } = await createToken({ label: label.trim(), scopes, expiresAt: expiry ? new Date(expiry).getTime() : null });
      setSecret({ token, record });
      setLabel(""); setExpiry("");
      refresh();
    } catch (failure) { setError(failureMessage(failure)); }
    finally { setBusy(false); }
  }

  return <section className={PANEL}>
    <div className={PANEL_HEADER}>
      <h2>API tokens</h2>
      <span className="ml-auto text-[11px] text-faint">for automation, not for people</span>
    </div>
    <div className={cn(PANEL_BODY, "flex flex-col gap-2")}>
      {secret && <NewSecret token={secret.token} record={secret.record} onDismiss={() => setSecret(undefined)} />}

      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState message={query.error.message} retry={() => void query.refetch()} />}
      {query.isSuccess && !tokens.length && <EmptyNote>No API token exists on this server.</EmptyNote>}
      {Boolean(tokens.length) && <TableFrame className="w-full">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Label</TableHead><TableHead>Scopes</TableHead><TableHead>Created</TableHead><TableHead>Last used</TableHead><TableHead>Expires</TableHead><TableHead aria-label="Actions" />
          </TableRow></TableHeader>
          <TableBody>{tokens.map(token => <TableRow key={token.id}>
            <TableCell className="max-w-48 truncate" title={token.id}>{token.label}</TableCell>
            <TableCell className="whitespace-normal"><span className="flex flex-wrap gap-1">{token.scopes.map(scope => <Badge key={scope} variant="outline" title={SCOPE_HELP[scope]}>{scope}</Badge>)}</span></TableCell>
            <TableCell title={`${moment(token.createdAt)} by ${token.createdBy}`}>{since(token.createdAt)}</TableCell>
            <TableCell title={moment(token.lastUsedAt)}>{token.lastUsedAt ? since(token.lastUsedAt) : <span className="text-faint">never</span>}</TableCell>
            <TableCell title={moment(token.expiresAt)}>{token.expiresAt ? since(token.expiresAt) : <span className="text-faint">never</span>}</TableCell>
            <TableCell className="text-right">
              <ConfirmAction label="Revoke" icon={<Trash2 />} size="xs"
                consequence={<>Anything using “{token.label}” stops working immediately. A revoked token cannot be brought back; create a new one instead.</>}
                confirmLabel="Revoke this token" onConfirm={async () => {
                  setError("");
                  try { await revokeToken(token.id); refresh(); } catch (failure) { setError(failureMessage(failure)); }
                }} />
            </TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </TableFrame>}

      <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="token-label">Label</label>
          <Input id="token-label" className="w-60" value={label} maxLength={64} placeholder="Content export workflow" onChange={event => setLabel(event.target.value)} />
          <label className="ml-2 text-xs text-muted-foreground" htmlFor="token-expiry">Expires</label>
          <Input id="token-expiry" className="w-52" type="datetime-local" value={expiry} onChange={event => setExpiry(event.target.value)} />
          <Button variant="secondary" size="sm" className="ml-auto" disabled={busy || !label.trim() || !scopes.length} onClick={() => void create()}>
            {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <KeyRound />}Create token
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Scopes</span>
          <ChoiceChips aria-label="Token scopes" items={API_SCOPES.map(scope => ({ value: scope, label: scope, title: SCOPE_HELP[scope] }))}
            value={scopes} onValueChange={next => setScopes(next as ApiScope[])} />
        </div>
        <p className="text-[11px] text-faint">A token carries only the scopes it is created with, and can never mint another token or grant a role.</p>
        <ActionError message={error} />
      </div>
    </div>
  </section>;
}

function NewSecret({ token, record, onDismiss }: { token: string; record: ApiTokenRecord; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return <div className={cn(PANEL, "border-primary/60")} aria-label="New API token">
    <div className={PANEL_HEADER}>
      <h3>{record.label}</h3>
      <Badge variant="warn" className="ml-auto">You will not see this again</Badge>
      <Button variant="ghost" size="sm" onClick={onDismiss}>Done</Button>
    </div>
    <div className={cn(PANEL_BODY, "flex flex-col gap-1.5")}>
      <div className="flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-sm border border-border bg-background px-2 py-1 font-mono text-[11px]">{token}</code>
        <Button variant="secondary" size="sm" onClick={() => { void navigator.clipboard?.writeText(token).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2_000); }, () => {}); }}>
          {copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The server keeps only a hash of this secret, so this panel is the one place it exists. Put it where the automation reads it now; if it is lost, revoke this token and create another.
      </p>
    </div>
  </div>;
}
