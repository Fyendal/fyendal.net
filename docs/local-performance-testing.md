# Local capacity testing

This profile measures the horizontally scaled production architecture with two
real server gateways, PostgreSQL 16, and protocol-level WebSocket clients. It
is isolated from the normal development and self-host stacks: the database is
named `fyendal_perf`, binds only to localhost on port `55432`, and uses its own
Docker volume.

It is a repeatable preflight, not an exact Cloud SQL emulator. Docker can bound
CPU, memory, connections, and network delay. It cannot reproduce shared-core
scheduling, managed storage, Cloud SQL maintenance, or Google Cloud network
jitter. The harness intentionally accepts only localhost application and
database endpoints; use a separate, explicitly non-production load plan for a
managed-environment capacity check.

## Default profile

- PostgreSQL 16 with `pg_stat_statements` and I/O timing enabled
- 0.5 CPU and 614 MB for PostgreSQL
- 192 MB PostgreSQL shared-buffer cache
- 40 maximum PostgreSQL connections (two 5-connection gateway pools plus the harness)
- 2 ms one-way application-to-database delay, approximately 4 ms round trip
- two gateways, each with 1 CPU and 768 MiB, matching the launch Cloud Run shape
- 200 active games, 400 authenticated player sockets, and 10 spectators
- every game's players deliberately connected to different gateways
- 10 games created through simultaneous cross-gateway durable matchmaking
- 10 games checked for concurrent version fencing and command deduplication
- 5% of player sockets disconnected and reconnected before measurement
- per-game decisions for 60 seconds: 10 seconds for an ordinary action and 1
  second for a pass, with initial decisions staggered across the think window
- up to 10 post-measurement undo checks
- one replay grown past 500 frames through real action and undo commits
- 120 games finished at 2 games per second for 60 seconds, including replay
  finalization
- replay-row, participant-payload, and long-replay HTTP retrieval validation

The harness addresses both gateways directly instead of placing a local proxy
in front of them. This makes placement deterministic: opponents use different
gateways, reconnects move to the other gateway, and long replay retrieval goes
through the gateway that did not host the requesting player. Production session
affinity is therefore not required for the test to pass.

The correctness phase is excluded from latency measurement. For each selected
game it:

- submits two mutations with the same expected room version from different gateways;
- requires exactly one receipt/version advance and one `stale room version` rejection;
- retries the fenced mutation and requires exactly one additional commit;
- sends the same legal intent and command ID twice;
- requires one room version advance, one command receipt, and one replay frame.

Think time is applied independently to every game; it is not a global action
cap. The report separates ordinary actions from passes, reads actual statement
calls from `pg_stat_statements`, and reports measured DB QPS and statements per
successful action.

## Run

Start or rebuild the isolated stack:

```sh
pnpm perf:up
```

Run the workload:

```sh
pnpm perf:load
```

Run the maximum local profile with 500 simultaneous games (1,000 player
sockets), 10-second ordinary actions, 1-second passes, two finishes per second
for 60 seconds, and two replays longer than 500 frames:

```sh
pnpm perf:load:500
```

The maximum profile intentionally raises the request timeout to two minutes.
Completion latency includes projection, gzip serialization, both player
payload writes, authoritative broadcast, and overlap with other paced finishes.

Inspect a point-in-time container resource snapshot and service logs:

```sh
pnpm perf:stats
pnpm perf:logs
```

Stop containers while preserving the performance database:

```sh
pnpm perf:down
```

Delete only the isolated `fyendal-perf` containers and database volume before
a clean comparison run:

```sh
pnpm perf:reset
```

`perf:reset` permanently deletes the synthetic performance database. It does
not touch the normal Compose volume or a database outside `fyendal-perf`.

## Useful controls

Compose resource controls are read when the stack is created:

```sh
PERF_DB_CPUS=1.0 PERF_DB_MEMORY=614m pnpm perf:up
PERF_DB_CPUS=0.5 PERF_DB_MEMORY=614m pnpm perf:up
PERF_DB_CPUS=0.25 PERF_DB_MEMORY=614m pnpm perf:up
PERF_APP_CPUS=2.0 PERF_APP_MEMORY=1g pnpm perf:up
```

`PERF_DB_MAX_CONNECTIONS` and `PERF_DB_SHARED_BUFFERS` can be set to values
read from the target instance's `pg_settings`. Recreate the stack between
resource shapes. Set the proxy delay to zero for a same-host baseline or
adjust it to a measured one-way Cloud SQL value:

```sh
PERF_DB_ONE_WAY_DELAY_MS=0 pnpm perf:up
```

Workload controls are read by `perf:load`:

```sh
PERF_GAMES=200 \
PERF_DURATION_SECONDS=300 \
PERF_ACTION_THINK_SECONDS=10 \
PERF_PASS_THINK_SECONDS=1 \
PERF_RECONNECT_PERCENT=5 \
PERF_SPECTATORS=10 \
PERF_MATCHMAKING_PAIRS=10 \
PERF_CORRECTNESS_GAMES=10 \
PERF_LONG_REPLAY_GAMES=1 \
PERF_LONG_REPLAY_FRAMES=550 \
PERF_LONG_REPLAY_COMMITS_PER_SECOND=10 \
PERF_FINISH_RATE=2 \
PERF_FINISH_DURATION_SECONDS=60 \
PERF_FINISH_GAMES=120 \
pnpm perf:load
```

`PERF_GAMES` accepts at most 500. `PERF_FINISH_GAMES=0` disables the completion
phase. By default, the finish count is the smaller of `PERF_GAMES` and finish
rate multiplied by finish duration; an explicit count may lower that value.
`PERF_MATCHMAKING_PAIRS` selects how many games are formed through durable FIFO
matchmaking; pairs are set up serially while each pair's two submissions race.
`PERF_CORRECTNESS_GAMES` selects how many active games receive the explicit
cross-gateway fencing/deduplication checks. Set either to `0` to disable that
phase. Both default to the smaller of 10 and `PERF_GAMES`.
`PERF_LONG_REPLAY_GAMES=0` disables long-replay construction, and
`PERF_LONG_REPLAY_FRAMES=0` disables it regardless of the game count. Long
replays are built before paced completion and must be among the games that
finish so the harness can fetch and decode the saved payload. Long-replay
commits are paced across both player sockets; keep their rate below the
production WebSocket message-rate limit unless testing that protection is the
goal.

For a fast harness smoke test:

```sh
PERF_GAMES=2 \
PERF_DURATION_SECONDS=5 \
PERF_ACTION_THINK_SECONDS=1 \
PERF_PASS_THINK_SECONDS=0.25 \
PERF_RECONNECT_PERCENT=50 \
PERF_SPECTATORS=1 \
PERF_MATCHMAKING_PAIRS=1 \
PERF_CORRECTNESS_GAMES=2 \
PERF_LONG_REPLAY_FRAMES=20 \
PERF_FINISH_RATE=2 \
PERF_FINISH_DURATION_SECONDS=1 \
pnpm perf:load
```

The harness refuses database URLs that are not localhost or do not use the
exact `fyendal_perf` database name. Override ports only when the defaults are
already occupied:

```sh
PERF_DB_PORT=55433 PERF_APP_PORT=8082 PERF_APP_PORT_2=8083 pnpm perf:up
PERF_DATABASE_URL=postgres://fyendal:fyendal-perf@127.0.0.1:55433/fyendal_perf \
PERF_APP_URLS=http://127.0.0.1:8082,http://127.0.0.1:8083 \
PERF_APP_ORIGIN=http://127.0.0.1:8082 \
pnpm perf:load
```

## Comparing changes

Use a new performance volume for each branch or reset between runs, use the
same resource shape and workload variables, and run each case at least three
times. Compare medians for:

- database statements per successful action;
- measured database QPS;
- action-to-authoritative-broadcast p50, p95, and p99 latency;
- paced-finish dispatch rate, throughput, and p50/p95/p99 latency;
- saved replay payload size and long-replay retrieval latency;
- commits, rollbacks, cache-hit rate, temporary files, and deadlocks;
- action, undo, reconnect, finish, replay-validation, protocol, and server errors;
- cross-gateway races, stale rejections, fenced retries, duplicate-command
  deduplication, and leftover matchmaking entries.

The workload setup is excluded from the measurement window. It still validates
authentication, room creation, player joins, presentation, die-winner choice,
game start, spectators, reconnects, state projection decoding, and cleanup.
