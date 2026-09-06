import { startGameServer } from "./lib/server.js";
const s = await startGameServer({ port: 4182, strictPort: true, hmr: false, logLevel: "info" });
console.log("SERVER_READY", s.url);
await new Promise(() => {});
