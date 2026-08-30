# Fyendal

Fyendal is a server-authoritative online client for testing Flesh and Blood
decks. It supports:

- Classic Battles with the fixed Rhinar and Dorinthea deck pools.
- Silver Age with Fabrary export-text deck imports and official precon pools.
- Classic Constructed with Fabrary imports and format-legal Armory Decks and
  preconstructed decks.
- Matchmaking, unlisted invite rooms, anonymous spectators, reconnects, undo,
  and seven-day player replays.

Fyendal is an unofficial, early-stage rules-testing project. It is not
affiliated with or endorsed by Legend Story Studios, and it should not be used
to adjudicate tournament rules. Refer to the
[official comprehensive rules](https://rules.fabtcg.com/en/cr/) when accuracy
matters.

## Local development

Requirements: Node 24, pnpm 10, Docker, and Postgres 16.

```sh
pnpm install
docker run -d --name fyendal-dev-db -p 5432:5432 \
  -e POSTGRES_USER=fyendal \
  -e POSTGRES_PASSWORD=fyendal \
  postgres:16-alpine
pnpm dev
```

Open <http://localhost:5173>. The server listens on port 8080. Create a
username/password account to play; spectators may join anonymously. Fyendal
does not collect email addresses or provide password recovery.

Useful local variables:

- `DATABASE_URL` — defaults to
  `postgres://fyendal:fyendal@localhost:5432/fyendal`.
- `APP_ORIGIN` — allowed browser origin; defaults to
  `http://localhost:5173` outside production.
- `RULESET_VERSION` — persisted-room compatibility identifier; the server dev
  script defaults to `development-seed`.
- `PORT` — combined HTTP/WebSocket port; defaults to `8080`.
- `TRUSTED_PROXY_HOPS` — trusted rightmost proxy hops; defaults to `0`.
- `AUTH_KDF_CONCURRENCY` — concurrent scrypt jobs; defaults to `1`.
- `VITE_API_ORIGIN` — API/WebSocket origin injected into hosted client builds;
  local development uses the server on port `8080` without it.

## Commands

```sh
pnpm dev                         # server + client
pnpm -r test                     # all package tests
pnpm -r typecheck                # all TypeScript checks
pnpm lint                        # repository lint
pnpm release:check               # tests, types, lint, audit, production builds
pnpm --filter @fyendal/server seed
RULESET_VERSION=<version> pnpm --filter @fyendal/server activate-ruleset
```

The seed command creates local `alice` and `bob` accounts (password
`password123`) and the `DEMO00` room. It is development-only: its guard rejects
production mode, Cloud Run, and Cloud SQL socket URLs. Never point it at a
shared or remote database.

## Repository

- `packages/shared` — types only.
- `packages/protocol` — exhaustive runtime decoders for wire, HTTP response,
  `GameView`, and replay data.
- `packages/engine` — deterministic, card-agnostic rules engine; see
  [packages/engine/DESIGN.md](packages/engine/DESIGN.md).
- `packages/cards` — card data, functional scripts, precons, and scenarios.
- `apps/server` — Postgres-backed HTTP/WebSocket service.
- `apps/client` — React, Vite, and Zustand client.

Any known rules gaps are executable `it.fails` scenarios registered in
[`docs/rules-limitations.json`](docs/rules-limitations.json). Card text and
stats come from the
[the-fab-cube/flesh-and-blood-cards](https://github.com/the-fab-cube/flesh-and-blood-cards)
dataset; card images are loaded from Fabrary.

Completed replays contain full-information frames, including both players'
hidden zones. The service retains them for seven days and makes them available
only to the two signed-in participants; exported replay files remain on the
player's device.

## License

Fyendal's original source code is licensed under the GNU General Public License
v3.0 only. See [LICENSE](LICENSE).

Third-party card data, fonts, trademarks, artwork, icons, and other licensed
assets remain subject to their respective owners' terms and are not relicensed
under the GPL merely by being included in this repository.
