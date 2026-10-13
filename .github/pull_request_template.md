## What this changes, and why

<!-- The why is the part worth writing. Link the issue if there is one. -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] Tests are in the top-level `tests/`, mirroring `src/`
- [ ] Anything that talks to a player follows the BluOS specification, not another client
      (`CLAUDE.md` lists the rules that are easy to get wrong)
- [ ] A change somebody using the plugin would notice has a changeset (`pnpm changeset`)
- [ ] If it changes how a key or dial draws, it has been seen on a Stream Deck, or the PR says it
      has not

<!--
CI on a pull request from a fork waits for a maintainer to approve each run. That is the
repository's setting for every outside contributor, not a judgement on this change.
-->
