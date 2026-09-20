import { useEffect, useState } from "react";
import { Button, ChoiceGroup, Input } from "../../components/ui/index.js";
import { AuditList } from "../../ui/AuditList.js";
import { useAccountNames } from "../../model/adminNames.js";
import { PAGE, PAGE_HEADING, TOOLBAR } from "../../ui/layout.js";

/**
 * Every administrative write this server has taken, newest first.
 *
 * The API filters by prefix, which is what makes one box enough: `player.` finds every player
 * write, `content.` every publish and rollback. The names beside the ids come from the first page
 * of players and the role list, so the common case — "who did this, and to whom" — reads without
 * looking anything up.
 */

/** `all` rather than an empty string: a segmented control cannot show "" as the chosen one. */
const KINDS = [
  { value: "all", label: "Everything" },
  { value: "player.", label: "Players" },
  { value: "ban.", label: "Bans" },
  { value: "content.", label: "Content" },
  { value: "role.", label: "Roles" },
  { value: "token.", label: "Tokens" },
  { value: "settings.", label: "Settings" },
  { value: "session.", label: "Sessions" },
] as const;

export default function AuditView() {
  const [kind, setKind] = useState("all");
  const [account, setAccount] = useState("");
  const [target, setTarget] = useState("");
  const [applied, setApplied] = useState({ account: "", target: "" });
  useEffect(() => {
    const timer = setTimeout(() => setApplied({ account: account.trim(), target: target.trim() }), 300);
    return () => clearTimeout(timer);
  }, [account, target]);

  const nameOf = useAccountNames();

  const filter = {
    ...(kind === "all" ? {} : { action: kind }),
    ...(applied.account ? { account: applied.account } : {}),
    ...(applied.target ? { target: applied.target } : {}),
    limit: 50,
  };
  const filtered = kind !== "all" || Boolean(applied.account || applied.target);

  return <div className={PAGE}>
    <div className={PAGE_HEADING}><h1>Audit log</h1></div>
    <div className={TOOLBAR}>
      <ChoiceGroup aria-label="Filter by action" items={KINDS.map(entry => ({ value: entry.value, label: entry.label }))} value={kind} onValueChange={next => setKind(next ?? "all")} />
      <label className="text-xs text-muted-foreground" htmlFor="audit-account">By</label>
      <Input id="audit-account" className="w-52 font-mono" value={account} spellCheck={false} placeholder="acc_… (prefix)" onChange={event => setAccount(event.target.value)} />
      <label className="text-xs text-muted-foreground" htmlFor="audit-target">To</label>
      <Input id="audit-target" className="w-52 font-mono" value={target} spellCheck={false} placeholder="account id or revision" onChange={event => setTarget(event.target.value)} />
      {filtered && <Button variant="ghost" size="sm" onClick={() => { setKind("all"); setAccount(""); setTarget(""); }}>Clear filters</Button>}
    </div>
    <AuditList filter={filter} nameOf={nameOf} emptyNote={filtered ? "No entry matches those filters." : "Nothing has been administered here yet."} />
  </div>;
}
