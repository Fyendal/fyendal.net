# Card script layout

Every scripted set has one canonical entry point at `scripts/<set>.ts`, using
the lowercase set code. The entry point exports the complete functional-keyed
script map for that set and is registered alphabetically in `scripts/index.ts`.

Keep a set in its entry-point file while that remains readable. When a set
needs to be split, put implementation partitions under `scripts/<set>/` and
compose them from the entry point with `mergeSetScripts`. The merger rejects
duplicate functional keys before one partition can silently override another.
Use names that describe the partition:

- `high-rarity.ts` for adult heroes and higher-rarity cards imported after the
  common/rare set module.
- Class or talent names such as `guardian.ts` or `arcane-generic.ts` when a
  large set is easier to navigate by card family.

Do not add root-level fragments such as `<set>-additional.ts`. Shared mechanics
used by multiple sets belong in `shared-helpers.ts`; helpers used by one set
stay with that set.

Script maps remain keyed by functional identity (`name lowercase|pitch`). The
central registry rejects duplicate keys between sets, and the layout test keeps
entry points, partitions, and registration ordering consistent.
