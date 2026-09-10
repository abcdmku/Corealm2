// Dev server variant for browser gates: same config, no hot reload. Another editor saving a render
// file mid-test must not reload the page under Playwright.
import { mergeConfig } from "vite";
import base from "./vite.config.ts";

export default mergeConfig(base, { server: { hmr: false, watch: null } });
