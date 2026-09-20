declare const __DEVDOCS_PLAYER__: boolean;
/** Which backend the build starts against: the repo's dev middleware, a live game server, or the guide. */
declare const __DEVDOCS_MODE__: "repo" | "server" | "player";

interface ImportMetaEnv {
  /** The identity service this page signs in through. Never taken from a game server. */
  readonly VITE_COREALM_IDENTITY_URL?: string;
}
