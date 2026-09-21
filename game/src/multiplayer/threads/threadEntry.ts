import { runThread } from "./threadRoles.js";

/** The entry of a server thread started from source. An error that stops the start is thrown, so the main thread's `Worker` reports it. */
void runThread().catch(error => { setImmediate(() => { throw error; }); });
