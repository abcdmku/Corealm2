import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, LoaderCircle, ServerCog } from "lucide-react";
import { IdentityClient } from "../../../game/src/multiplayer/identityClient.js";
import {
  AdminFailure, audienceOf, chooseIdentity, exchangeSession, identityUrl, normalizeServerUrl, readDescriptor, rememberedServer, rememberServer,
  writeSession, type AdminSession, type ServerDescriptor,
} from "../api/session.js";
import { Button, Input } from "../components/ui/index.js";
import { PANEL, PANEL_BODY, PANEL_HEADER } from "./layout.js";
import { cn } from "../lib/utils.js";

/**
 * Signing devdocs in to one game server.
 *
 * Three steps, and only one of them is the game server's business. The page's own identity service
 * signs the admin in; it mints a join token for this server's published endpoint, which is not
 * necessarily the address typed here — a host behind a proxy publishes the proxy's origin, and the
 * server refuses a token minted for anything else; and `POST /admin/session` trades that token for a
 * 12 hour session. A server that has no owner yet takes the one-time setup code printed at its first
 * start through `POST /admin/setup` instead, which makes the first correct caller its owner.
 *
 * The identity address belongs to the page, not to a server an admin typed the address of: a server
 * that could name its own identity service could name a lookalike and collect sessions. The one
 * exception is a build the game server served itself, where the page and the API are the same
 * origin. `chooseIdentity` in `api/session.ts` is that rule, and it refuses outright when the page
 * and the server name different ones.
 */

/** Served from the game server itself at `/admin`: the server is the page's own origin, so do not ask. */
function hostedServer(): string | null {
  if (typeof location === "undefined") return null;
  const path = location.pathname.replace(/\/+$/, "");
  return path.endsWith("/admin") ? `${location.origin}${path.slice(0, -"/admin".length)}` : null;
}

type Step =
  | { phase: "server" }
  | { phase: "identity"; server: string; descriptor: ServerDescriptor; identity: string }
  | { phase: "no-role"; server: string; descriptor: ServerDescriptor; identity: string; name: string; accountId: string }
  | { phase: "setup"; server: string; descriptor: ServerDescriptor; identity: string; name: string };

export function SignIn({ onSignedIn }: { onSignedIn: (session: AdminSession) => void }) {
  const configured = identityUrl();
  const hosted = hostedServer();
  const [step, setStep] = useState<Step>({ phase: "server" });
  const [address, setAddress] = useState(() => hosted ?? rememberedServer() ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"" | "server" | "session" | "setup">("");
  const [error, setError] = useState("");
  const started = useRef(false);

  // The identity service is not known until the server is, because a build the game server served
  // itself may take it from that server. One client per address, so a sign-in redirect comes back
  // to a screen that still remembers which server it was opening.
  const identity = step.phase === "server" ? configured : step.identity;
  const client = useMemo(() => identity ? new IdentityClient(identity) : null, [identity]);
  const [account, setAccount] = useState(() => client?.account() ?? null);
  useEffect(() => { setAccount(client?.account() ?? null); return client?.subscribe(() => setAccount(client.account())); }, [client]);
  useEffect(() => { const failure = client?.loginFailure(); if (failure) setError(failure); }, [client]);

  /** Reads `/admin/info`, which carries the token audience, the asset host and the identity service. */
  const reachServer = useCallback(async (raw: string) => {
    setBusy("server"); setError("");
    try {
      const server = normalizeServerUrl(raw);
      const descriptor = await readDescriptor(server);
      const choice = chooseIdentity(configured, server, descriptor.identityUrl, typeof location === "undefined" ? null : location.origin);
      if (!choice.ok) { setError(choice.reason); return; }
      rememberServer(server);
      setStep({ phase: "identity", server, descriptor, identity: choice.url });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That server could not be reached.");
    } finally { setBusy(""); }
  }, [configured]);

  // Served at `/admin`, the server is the page it came from, so the address is never a question. A
  // remembered address is not a question either, and signing in leaves the page: coming back to the
  // address form and having to press Connect again would make a redirect login feel like a mistake.
  useEffect(() => {
    const known = hosted ?? rememberedServer();
    if (!known || started.current) return;
    started.current = true;
    void reachServer(known);
  }, [hosted, reachServer]);

  async function exchange(setupCode?: string): Promise<void> {
    if (step.phase === "server" || !client) return;
    const { server, descriptor } = step;
    setBusy(setupCode ? "setup" : "session"); setError("");
    try {
      const audience = audienceOf(descriptor.endpoint);
      const joinToken = await client.joinToken(audience);
      const session = await exchangeSession({ server, audience, joinToken, ...(setupCode ? { setupCode } : {}) });
      writeSession(session);
      onSignedIn(session);
    } catch (reason) {
      if (reason instanceof AdminFailure && reason.status === 403 && !setupCode) {
        setStep({ phase: "no-role", server, descriptor, identity: step.identity, name: account?.name ?? "", accountId: account?.id ?? "" });
        setError("");
        return;
      }
      setError(reason instanceof Error ? reason.message : "Signing in to that server failed.");
    } finally { setBusy(""); }
  }

  const descriptor = step.phase === "server" ? undefined : step.descriptor;

  return <Frame title={descriptor ? descriptor.name : "Sign in"} subtitle={step.phase === "server" ? undefined : step.server}>
    {step.phase === "server" && <form className={FORM} onSubmit={event => { event.preventDefault(); void reachServer(address); }}>
      <Field label="Server address" htmlFor="signin-server">
        <Input id="signin-server" value={address} autoFocus spellCheck={false} placeholder="https://play.example.com" onChange={event => setAddress(event.target.value)} />
      </Field>
      <Row><Button type="submit" disabled={busy === "server" || !address.trim()}>{busy === "server" ? <LoaderCircle className="animate-spin" /> : <ServerCog />}Connect</Button></Row>
      <p className={TEXT}>The address of the game server to administer. It is remembered for next time.</p>
    </form>}

    {step.phase === "identity" && client && (account
      ? <div className={FORM}>
        <Field label="Signed in as"><span className={VALUE}>{account.name}</span></Field>
        <Row>
          <Button onClick={() => void exchange()} disabled={busy === "session"}>{busy === "session" ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Open this server</Button>
          <Button variant="ghost" onClick={() => client.changePassword()}>Change password</Button>
          <Button variant="ghost" onClick={() => void client.logout()}>Use another account</Button>
        </Row>
      </div>
      : <div className={FORM}>
        <p className={TEXT}>Sign in with the account that holds a role on this server. The password is typed on the identity service's own page, never here.</p>
        <Row><Button variant="secondary" onClick={() => client.login()}>Sign in</Button></Row>
      </div>)}

    {step.phase === "no-role" && <div className={FORM}>
      <Field label="Signed in as"><span className={VALUE}>{step.name || step.accountId}</span></Field>
      <p className={TEXT}>This account holds no role on this server, so it cannot be given an admin session. Ask an owner to add it, or claim an unowned server with the setup code it printed at its first start.</p>
      <Row>
        <Button variant="secondary" onClick={() => setStep({ phase: "setup", server: step.server, descriptor: step.descriptor, identity: step.identity, name: step.name })}>Enter setup code</Button>
        {client && <Button variant="ghost" onClick={() => void client.logout()}>Use another account</Button>}
      </Row>
    </div>}

    {step.phase === "setup" && <form className={FORM} onSubmit={event => { event.preventDefault(); void exchange(code); }}>
      <Field label="Setup code" htmlFor="signin-code">
        <Input id="signin-code" value={code} autoFocus spellCheck={false} placeholder="K7M3Q-2WXPR-9TVBH-4CJ8N" onChange={event => setCode(event.target.value)} />
      </Field>
      <Row>
        <Button type="submit" disabled={busy === "setup" || !code.trim()}>{busy === "setup" ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Claim this server</Button>
        <Button variant="ghost" type="button" onClick={() => setStep({ phase: "identity", server: step.server, descriptor: step.descriptor, identity: step.identity })}>Back</Button>
      </Row>
      <p className={TEXT}>The code is printed once when a server starts with no owner. Case and separators do not matter. The first correct answer becomes owner and spends the code.</p>
    </form>}

    {error && <p className="text-xs text-destructive [overflow-wrap:anywhere]" role="alert">{error}</p>}
  </Frame>;
}

/**
 * One column of labels and one of controls, so buttons and help text line up under the field they
 * belong to instead of starting back at the card edge. It is the same reading order as a record
 * sheet, which is where an author spends the rest of their day.
 */
const FORM = "grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 max-sm:grid-cols-1 max-sm:gap-y-1.5";
const VALUE_COLUMN = "col-start-2 flex flex-wrap items-center gap-2 max-sm:col-start-1";
const TEXT = "col-start-2 text-xs leading-relaxed text-muted-foreground max-sm:col-start-1";
const VALUE = "text-[13px] text-foreground";
const LABEL = "col-start-1 pt-1.5 text-xs text-muted-foreground max-sm:pt-0";

const Row = ({ children }: { children: React.ReactNode }) => <div className={VALUE_COLUMN}>{children}</div>;

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return <>
    <label className={LABEL} htmlFor={htmlFor}>{label}</label>
    <div className="col-start-2 min-w-0 max-sm:col-start-1">{children}</div>
  </>;
}

function Frame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-background px-4 py-10">
    <div className={cn(PANEL, "w-full max-w-md")}>
      <div className={PANEL_HEADER}>
        <h2>{title}</h2>
        {subtitle && <code className="ml-auto truncate font-mono text-[11px] text-faint">{subtitle}</code>}
      </div>
      <div className={cn(PANEL_BODY, "flex flex-col gap-3 py-3")}>{children}</div>
    </div>
  </div>;
}
