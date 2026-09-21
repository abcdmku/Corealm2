/**
 * The pages the identity service serves itself.
 *
 * A password is only ever typed on this origin, so these are the only screens that ask for one. They
 * are hand written HTML with one inline stylesheet, no script and no external file: nothing here can
 * be tampered with by whatever page sent the player, and the strict CSP below is a promise the pages
 * can actually keep.
 *
 * Every page names the site that asked for the sign-in, because the one thing a player cannot check
 * for themselves is where the session is about to be handed to.
 */

export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * A form page also names where its own POST is allowed to land.
 *
 * Chromium applies `form-action` to the redirect a submission ends on, not only to the address in
 * the `action` attribute, so a bare `'self'` blocks the 303 that carries the session back to the
 * game. The origin added here is one that was already checked against the return allow-list, which
 * is the same set the redirect itself is confined to.
 */
export function pageHeaders(returnOrigin?: string): Record<string, string> {
  if (!returnOrigin) return { ...PAGE_HEADERS };
  return {
    ...PAGE_HEADERS,
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${returnOrigin}; frame-ancestors 'none'; base-uri 'none'`,
  };
}

/** Everything interpolated into a page goes through this, including values a caller chose. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => (
    character === "&" ? "&amp;" : character === "<" ? "&lt;" : character === ">" ? "&gt;"
      : character === '"' ? "&quot;" : "&#39;"));
}

/** The origin a player is being sent back to, or the whole string when it will not parse. */
export function displayOrigin(returnUrl: string): string {
  try { return new URL(returnUrl).origin; } catch { return returnUrl; }
}

export type PageKind = "login" | "register" | "password";

export interface FormPageInput {
  kind: PageKind;
  /** Single use, short lived, and bound to the return URL this page was built for. */
  state: string;
  returnUrl: string;
  /** Kept across a failure where it is safe to: never on a refused sign-in. */
  username?: string;
  error?: string;
  /** Whether to offer the "create an account" link at all. */
  registrationOpen: boolean;
}

const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; padding: 24px 16px; display: grid; place-items: center;
  background: #14130d; color: #f2e5c7; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main { width: 100%; max-width: 25rem; padding: 24px; background: #1b1a12; border: 1px solid #514833; border-radius: 6px; }
.mark { margin: 0; font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: #8a7f68; }
h1 { margin: 4px 0 0; font-size: 22px; font-weight: 600; letter-spacing: .01em; }
.where { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: #b6aa91; overflow-wrap: anywhere; }
.where strong { font-weight: 600; color: #d6bf85; }
.alert { margin: 16px 0 0; padding: 10px 12px; font-size: 13px; line-height: 1.5; color: #f4d9cb; background: #2b1a14; border: 1px solid #7a4534; border-radius: 4px; }
form { margin: 16px 0 0; display: grid; gap: 14px; }
.field { display: grid; gap: 5px; }
label { font-size: 13px; color: #b6aa91; }
input { width: 100%; padding: 9px 10px; font: inherit; font-size: 15px; color: #f2e5c7; background: #17160f; border: 1px solid #63553b; border-radius: 3px; }
input:focus-visible { outline: 2px solid #d6bf85; outline-offset: 1px; border-color: #d6bf85; }
button { width: 100%; padding: 10px 12px; font: inherit; font-size: 15px; font-weight: 600; color: #f7ecd2; background: #4a3f27; border: 1px solid #7a6a45; border-radius: 3px; cursor: pointer; }
button:hover { background: #594c2f; }
button:focus-visible { outline: 2px solid #d6bf85; outline-offset: 2px; }
.hint { margin: 0; font-size: 12px; line-height: 1.5; color: #8a7f68; }
.aside { margin: 16px 0 0; padding-top: 14px; font-size: 13px; color: #b6aa91; border-top: 1px solid #332d20; }
a { color: #d6bf85; }
a:focus-visible { outline: 2px solid #d6bf85; outline-offset: 2px; }
.foot { margin: 14px 0 0; font-size: 12px; line-height: 1.5; color: #6f6551; }
@media (max-width: 380px) { body { padding: 16px 12px; } main { padding: 18px 16px; } h1 { font-size: 20px; } }
`.trim();

function shell(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${STYLE}
</style>
</head>
<body>
<main>
${content}
</main>
</body>
</html>
`;
}

const HEADINGS: Record<PageKind, { title: string; heading: string; submit: string; lead: string }> = {
  login: { title: "Sign in to Corealm", heading: "Sign in", submit: "Sign in", lead: "Signing in to continue to" },
  register: { title: "Create a Corealm account", heading: "Create an account", submit: "Create account", lead: "Creating an account to play on" },
  password: { title: "Change your Corealm password", heading: "Change your password", submit: "Change password", lead: "Changing your password, then back to" },
};

function field(input: {
  id: string; label: string; type: string; name: string; autocomplete: string; value?: string;
  autofocus?: boolean; maxLength?: number; minLength?: number; hint?: string; describedBy?: string;
}): string {
  const attributes = [
    `id="${input.id}"`, `name="${input.name}"`, `type="${input.type}"`, `autocomplete="${input.autocomplete}"`,
    "required", "spellcheck=\"false\"",
    ...(input.value === undefined ? [] : [`value="${escapeHtml(input.value)}"`]),
    ...(input.maxLength ? [`maxlength="${input.maxLength}"`] : []),
    ...(input.minLength ? [`minlength="${input.minLength}"`] : []),
    ...(input.autofocus ? ["autofocus"] : []),
    ...(input.describedBy ? [`aria-describedby="${input.describedBy}"`] : []),
  ];
  return `<div class="field">
<label for="${input.id}">${escapeHtml(input.label)}</label>
<input ${attributes.join(" ")}>
${input.hint ? `<p class="hint" id="${input.id}-hint">${escapeHtml(input.hint)}</p>` : ""}</div>`;
}

/** The sign-in, registration and password-change form, rendered with whatever went wrong last time. */
export function formPage(input: FormPageInput): string {
  const { title, heading, submit, lead } = HEADINGS[input.kind];
  const origin = displayOrigin(input.returnUrl);
  const back = `?return=${encodeURIComponent(input.returnUrl)}`;
  const describedBy = input.error ? "form-error" : undefined;
  const fields = input.kind === "login" ? [
    field({ id: "username", label: "Username", type: "text", name: "username", autocomplete: "username", maxLength: 24, autofocus: true, ...(describedBy ? { describedBy } : {}), ...(input.username === undefined ? {} : { value: input.username }) }),
    field({ id: "password", label: "Password", type: "password", name: "password", autocomplete: "current-password", maxLength: 256, ...(describedBy ? { describedBy } : {}) }),
  ] : input.kind === "register" ? [
    field({ id: "username", label: "Username", type: "text", name: "username", autocomplete: "username", maxLength: 24, minLength: 3, autofocus: true, hint: "3 to 24 letters, digits, underscore or hyphen. Other players see this name.", ...(describedBy ? { describedBy } : {}), ...(input.username === undefined ? {} : { value: input.username }) }),
    field({ id: "password", label: "Password", type: "password", name: "password", autocomplete: "new-password", maxLength: 256, minLength: 10, hint: "At least 10 characters. Nothing else is required.", ...(describedBy ? { describedBy } : {}) }),
  ] : [
    field({ id: "username", label: "Username", type: "text", name: "username", autocomplete: "username", maxLength: 24, autofocus: true, ...(describedBy ? { describedBy } : {}), ...(input.username === undefined ? {} : { value: input.username }) }),
    field({ id: "current", label: "Current password", type: "password", name: "current", autocomplete: "current-password", maxLength: 256, ...(describedBy ? { describedBy } : {}) }),
    field({ id: "password", label: "New password", type: "password", name: "password", autocomplete: "new-password", maxLength: 256, minLength: 10, hint: "At least 10 characters. Every other sign-in is signed out.", ...(describedBy ? { describedBy } : {}) }),
  ];
  const aside = input.kind === "login"
    ? (input.registrationOpen ? `<p class="aside">New to Corealm? <a href="/register${escapeHtml(back)}">Create an account</a></p>` : "")
    : `<p class="aside"><a href="/login${escapeHtml(back)}">Back to sign in</a></p>`;
  return shell(title, `<p class="mark">Corealm</p>
<h1>${escapeHtml(heading)}</h1>
<p class="where">${escapeHtml(lead)} <strong>${escapeHtml(origin)}</strong></p>
${input.error ? `<div class="alert" id="form-error" role="alert">${escapeHtml(input.error)}</div>` : ""}
<form method="post" action="/${input.kind}">
<input type="hidden" name="state" value="${escapeHtml(input.state)}">
${fields.join("\n")}
<button type="submit">${escapeHtml(submit)}</button>
</form>
${aside}
<p class="foot">Corealm asks for your password on this page and nowhere else.</p>`);
}

/** A page with nothing to fill in: an expired form, a closed registration, a refused return URL. */
export function noticePage(input: { title: string; heading: string; body: string }): string {
  return shell(input.title, `<p class="mark">Corealm</p>
<h1>${escapeHtml(input.heading)}</h1>
<p class="where">${escapeHtml(input.body)}</p>`);
}
