# Fabrary play links

Fabrary can link a public deck directly to Fyendal:

```text
https://fyendal.net/play?fabrary=<URL-encoded-public-Fabrary-deck-URL>&format=cc
```

Example:

```text
https://fyendal.net/play?fabrary=https%3A%2F%2Ffabrary.net%2Fdecks%2F01M1WZTPC64GDCMN2GX752E3R7&format=cc
```

Build the query with `URLSearchParams`, supplying the unencoded deck URL as
the `fabrary` value. Supported formats are `cc` and `silver-age`; `compcc` is
accepted as an alias for `cc`. The format is required. Unsupported formats
show an error rather than silently choosing another format. Additional
Talishar-style parameters do not control authentication or create a game.

`/play/` is also supported. The client build emits `play/index.html` for static
hosts using directory index resolution. Configure the host's SPA fallback or
rewrite `/play` and `/play/` to this file, preserving the query string. Verify
the public link and a refresh after deployment before publishing the link.

## Player flow

1. Preview the public deck's name, hero name, and hero portrait before signing
   in. The login/signup form replaces the play options for guests.
2. Log in or create a Fyendal account if needed. Registration signs in
   automatically. Refreshing or an expired session preserves the request.
3. Load the latest public Fabrary deck. The account's existing deck with the
   same canonical source and format is refreshed; otherwise it is saved once.
   Existing user-selected deck names are preserved.
4. Select a card pool and choose **Find a player** or **Play vs AI**. AI
   practice starts with background player search checked, and the player
   can turn it off in the opponent picker.
   On laptop screens, a short site introduction and gameplay image appear
   beside the deck card.
5. Continue through normal pre-game preparation, including equipment,
   sideboarding, Fabrary matchup plans, and deck presentation validation.

Implemented banned and unreleased cards are imported and retained:

| Card pool | Allowed cards |
| --- | --- |
| Legal | Currently tournament-legal cards |
| Future | Tournament-legal and implemented unreleased cards |
| Open | All implemented cards, including banned cards and Living Legend heroes |

The page shows card counts with expandable name lists and asks the player to choose a mode
that supports the deck. It does not remove cards or silently change modes.
Unknown or unimplemented cards produce an import error listing the cards.
Private/missing decks and Fabrary availability failures can be retried.

Existing games in other tabs are preserved and do not block starting another
game from a play link. Once the server acknowledges the new
player search or room, the entry request is consumed.

## Server

`POST /api/decks/preview` accepts `{ "url": "https://fabrary.net/decks/..." }`
without authentication and returns only the public deck name and hero name.
It uses the existing HTTP rate limiter and Fabrary URL validation. It creates
no saved rows and does not require the cards to be playable. Preview failures
can be retried while the login form remains available.

`POST /api/decks/play` requires a Fyendal bearer session and a JSON body:

```json
{
  "url": "https://fabrary.net/decks/01M1WZTPC64GDCMN2GX752E3R7",
  "format": "cc"
}
```

It returns the existing deck response shape, including banned/future card
hints. Server-side source validation permits only Fabrary public deck URLs;
the existing Fabrary client calls its fixed API host using
`FABRARY_API_SECRET`. The provider request happens before the database
transaction. An account-row lock serializes lookup/create across instances.
No new tables or persisted game/ruleset changes are required.
