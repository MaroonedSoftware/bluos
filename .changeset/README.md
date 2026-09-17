# Changesets

A change worth a release gets one: `pnpm changeset`, describe it in a sentence, commit the file it
writes. Merging a version pull request is then the whole of cutting a release.

The plugin is not published to npm. `access` is `restricted` and the package is private; changesets
is here for the version and the changelog, and the release itself is a `.streamDeckPlugin` on a
GitHub release.
