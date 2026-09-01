# Fyendal

[Play Flesh and Blood online at fyendal.net](https://fyendal.net/).

Fyendal is an open-source, server-authoritative platform for playing and
testing Flesh and Blood decks in the browser. It automates game rules, keeps
hidden information on the server, and supports both player matches and
matchup-aware practice bots.

## Features

- Classic Constructed and Silver Age play.
- Deck imports from public Fabrary URLs or Fabrary export text.
- Bundled, format-legal preconstructed decks for getting started quickly.
- Matchmaking plus public and private rooms with shareable invite links.
- Anonymous spectating, reconnectable games, and room undo history.
- Practice opponents with hero-specific decks and policies.
- Full-information player replays retained for seven days, with local export.

Fyendal is an unofficial, early-stage rules-testing project. It is not
affiliated with or endorsed by Legend Story Studios and should not be used to
adjudicate tournament rules. Refer to the
[official comprehensive rules](https://rules.fabtcg.com/en/cr/) when accuracy
matters.

## Local development

Requirements:

- Node.js 24
- pnpm 10 (the repository pins the exact version through Corepack)
- Docker
- PostgreSQL 16

Install dependencies and start a local database:

```sh
corepack enable
pnpm install

docker run -d --name fyendal-dev-db -p 5432:5432 \
  -e POSTGRES_USER=fyendal \
  -e POSTGRES_PASSWORD=fyendal \
  -e POSTGRES_DB=fyendal \
  postgres:16-alpine
```

Start the server and client development processes:

```sh
pnpm dev
```

Open <http://localhost:5173>. The API and WebSocket server listens on port
`8080`. Create a username/password account to play; spectators may join through
a room link without an account. Fyendal does not collect email addresses or
provide password recovery.

### Local configuration

The development defaults work with the database command above. Override them
through environment variables when needed:

- `DATABASE_URL` — defaults to
  `postgres://fyendal:fyendal@localhost:5432/fyendal`.
- `APP_ORIGIN` — allowed browser origin; defaults to
  `http://localhost:5173` in development.
- `RULESET_VERSION` — persisted-game compatibility identifier; the development
  server defaults to `development-seed`.
- `PORT` — API and WebSocket port; defaults to `8080`.
- `TRUSTED_PROXY_HOPS` — trusted rightmost proxy hops; defaults to `0`.
- `AUTH_KDF_CONCURRENCY` — concurrent password scrypt jobs; defaults to `1`.
- `VITE_API_ORIGIN` — API and WebSocket origin for hosted client builds; local
  development uses port `8080` automatically.

### Seed data

For a development-only fixture, run:

```sh
pnpm --filter @fyendal/server seed
```

This creates local `alice` and `bob` accounts with password `password123` and
the `DEMO00` room. The command refuses production environments and remote
Cloud SQL connections. Never point it at a shared database.

## Commands

```sh
pnpm dev                       # run the server and client
pnpm test                      # run all workspace tests
pnpm typecheck                 # run all TypeScript checks
pnpm lint                      # lint the repository
pnpm check:rules-limitations   # validate tracked rules gaps
pnpm check:card-images         # validate card image availability
pnpm release:check             # run the complete release-quality gate
```

## Project structure

- `apps/client` — React, Vite, and Zustand browser client.
- `apps/server` — Postgres-backed HTTP and WebSocket gateway.
- `packages/bot` — practice-opponent registry, policies, planners, and
  evaluation tests.
- `packages/cards` — card data, functional scripts, preconstructed decks, and
  scenario tests.
- `packages/engine` — deterministic, card-agnostic rules engine; see
  [packages/engine/DESIGN.md](packages/engine/DESIGN.md).
- `packages/protocol` — exhaustive runtime decoders for WebSocket messages,
  HTTP responses, game views, and replay files.
- `packages/shared` — stable data contracts and protocol error codes.

The engine is deterministic and performs no I/O. Games change only through
validated player intents, and randomness comes from persisted seeded state.
Card behavior lives outside the engine in functional scripts that can mutate
state only through the script context API.

## Card coverage and known limitations

Deck imports are validated against the implemented card pool. A card must have
a functional script or a verified vanilla entry before it can be used. This
means a deck can be legal in the physical game while still being unsupported
by Fyendal.

Known rules gaps are executable expected-failure scenarios registered in
[`docs/rules-limitations.json`](docs/rules-limitations.json). Card text and
stats come from the
[the-fab-cube/flesh-and-blood-cards](https://github.com/the-fab-cube/flesh-and-blood-cards)
dataset; card images are loaded from Fabrary.

## Replay privacy

Completed replays contain full-information frames, including both players'
hidden zones. Server-held replays are available only to the two signed-in
participants and expire after seven days. Exported replay files remain on the
player's device and should be shared with care.

## License

Fyendal's original source code is licensed under the GNU General Public License
v3.0 only. See [LICENSE](LICENSE).

Third-party card data, fonts, trademarks, artwork, icons, and other licensed
assets remain subject to their respective owners' terms and are not relicensed
under the GPL merely by being included in this repository.
