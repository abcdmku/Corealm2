import { LogOut } from "lucide-react";
import { backend } from "../api/backend.js";
import { clearSession, readSession, revokeSession } from "../api/session.js";
import { Button } from "../components/ui/index.js";

/**
 * Who is signed in, to what, and the way out. It sits in the sidebar footer where the mode label
 * always was, because "what would a save write to" is a question an author should never have to go
 * looking for.
 */
export function SessionFooter() {
  const target = backend();
  if (target.kind !== "server") return <span className="truncate">{target.label}</span>;
  const session = readSession();
  if (!session) return <span className="truncate">{target.label}</span>;
  return <>
    <span className="min-w-0 flex flex-1 flex-col leading-tight">
      <span className="truncate text-foreground" title={session.server}>{target.label}</span>
      <span className="truncate text-faint">{session.name} · {session.role}</span>
    </span>
    <Button variant="ghost" size="icon-sm" aria-label="Sign out" title={`Sign out of ${target.label}`} onClick={() => {
      // Reload rather than unmount: signing out is deliberate, and a reload is the one way to be
      // certain no cached collection of this server's content is left in the page.
      void revokeSession(session).finally(() => { clearSession(); location.reload(); });
    }}><LogOut /></Button>
  </>;
}
