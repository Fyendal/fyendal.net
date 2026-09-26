# Browser bot computation

Practice-bot thinking runs in the authenticated human participant's browser.
The server remains authoritative for legality, game execution, persistence,
undo, and replay, and supplies a conservative fallback when browser computation
fails. There is no autonomous server search or startup bot scheduling.
Deploy matching server and client artifacts together; incompatible tabs must
refresh. This does not change persisted game state or the active ruleset.

The browser receives a separate, versioned task only while the bot has priority.
Clean action decisions include a simulation snapshot. Reactive decisions carry
only the bot's view and legal intents. Snapshots preserve rule-relevant fields
but replace both deck orders and the seed/RNG state, remove logs, and retain
current-turn statistics. They reveal deck composition and bot hidden cards to
the human participant, but are never delivered to spectators, stored in browser
storage, recorded in replays, or included in cross-instance events.

The server authenticates each submission in the room transaction, checks bot
priority and the expected room version, and applies only its intent. Commands
use the existing durable deduplication mechanism. Bot-room tabs from the owning
account can reuse a valid room credential.
Optimistic versions fence simultaneous submissions across gateways. Reclaiming
a seat without a valid credential still rotates it and supersedes older tabs;
other rooms retain their existing rotation behavior. Undo invalidates pending
work and continuations.

Worker startup has a ten-second budget; each decision has a five-second budget.
Failure requests a conservative server-selected legal move without search.
Three consecutive loading, computation, or submission failures open a
connection-local circuit breaker.
The recovery notice offers a retry, and reconnect also resets the circuit.
Disconnected and incompatible clients pause bot play. An incompatible client
must refresh; it does not trigger expensive server search.

The root command `pnpm generate:bot-runtime` generates an ignored runtime
fingerprint from shared contracts, protocol, engine, cards, bot sources, and
dependency versions. Package build, test, typecheck, and dev scripts delegate
to that command so filtered package commands also work on a clean checkout.
The client dev watcher uses the same command when shared runtime sources
change; the server dev entry regenerates it before each restart, including
standalone server development. The fingerprint is separate from the
operator-managed `RULESET_VERSION`.

Tasks are capped at 256 KiB of UTF-8 JSON. Larger tasks send a small fallback
request instead. Representative compact tasks measured 15–22 KB at their
sampled maximum; the worker is a separate lazy asset, approximately 752 KB
gzipped in the initial production build. Normal game-state fan-out remains.

Monitor `client_bot_task` records for task bytes and simulation use, and
`client_bot_submission` for applied/stale/rejected counts, client-reported
compute/elapsed milliseconds, and fallback reasons. These records contain no
snapshots, cards, credentials, or private game logs. Client-reported timing is
telemetry only. Compare server CPU under similar practice-game load.
Frequent loading/timeouts warrant investigation of asset
delivery and device performance; frequent stale submissions warrant inspection
of undo, reconnect, and version churn.
