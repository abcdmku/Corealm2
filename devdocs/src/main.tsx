import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { setBackend } from "./api/backend.js";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/theme.css";

/**
 * Which backend the editor runs against, decided before anything else loads.
 *
 * The rest of the app reads the installed backend at module scope — the workspace list drops the
 * surfaces a mode does not have — so nothing under `shell.tsx` may be imported until `setBackend`
 * has run. In server mode that means after sign-in, which is why the shell arrives through a dynamic
 * import rather than a static one. It also keeps the editor out of the sign-in screen's chunk.
 */

const root = createRoot(document.getElementById("root")!);

async function mount(): Promise<void> {
  const { Shell } = await import("./shell.js");
  root.render(<React.StrictMode><Shell /></React.StrictMode>);
}

async function signIn(): Promise<void> {
  const [{ SignIn }, session] = await Promise.all([import("./ui/SignIn.js"), import("./api/session.js")]);
  const held = session.readSession();
  if (held) { await open(held); return; }
  root.render(<React.StrictMode><SignIn onSignedIn={next => { void open(next); }} /></React.StrictMode>);
}

async function open(held: import("./api/session.js").AdminSession): Promise<void> {
  const [{ createServerBackend }, { readDescriptor }, { clearSession }] = await Promise.all([
    import("./api/serverBackend.js"), import("./api/session.js"), import("./api/session.js"),
  ]);
  let descriptor;
  try { descriptor = await readDescriptor(held.server); }
  catch { clearSession(); await signIn(); return; }
  setBackend(createServerBackend({
    session: held, descriptor,
    // Drafts live in the draft store, which outlives the unmount, so an expiry costs no work.
    onUnauthorized: () => { clearSession(); void signIn(); },
  }));
  await mount();
}

async function start(): Promise<void> {
  if (__DEVDOCS_MODE__ === "server") { await signIn(); return; }
  if (__DEVDOCS_PLAYER__) {
    const { createPlayerBackend } = await import("./api/playerBackend.js");
    setBackend(createPlayerBackend());
  } else {
    const { createRepoBackend } = await import("./api/repoBackend.js");
    setBackend(createRepoBackend());
  }
  await mount();
}

void start();
