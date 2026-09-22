# Trained Corealm players

Build shared, game-specific trained policies for 50-100 simultaneous AI players. Use a TypeScript orchestrator and ONNX Runtime. Keep gameplay independent of an LLM; reserve an optional provider for dialogue and occasional structured goal proposals.

The first milestone is one combat arena and one gather -> inventory full -> bank loop, trained end to end and evaluated with 100 active agents in one shared world. Agents control newly created regular accounts. Human players may join in addition to those 100.

The user confirmed on September 20, 2026:

- Perform all implementation, training, and benchmarking on this machine with its RTX 5080.
- Defer a real LLM provider, but train decisions about replying to messages and spontaneously initiating conversations. Adding a conforming provider should enable dialogue without policy retraining.
- Accept initial held-out gates of 90% combat success, 95% gather/bank completion, and no unrecovered stalls longer than 10 seconds.
- Preserve the original reaction targets of <=200 ms p95 and <=400 ms p99, with casual decisions within 1-10 seconds.

The full implementation and acceptance scope is in [PRD.md](./PRD.md).
