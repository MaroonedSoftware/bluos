# A BluOS player on a Stream Deck

This repository is an Elgato Stream Deck plugin that controls a BluOS player (Bluesound, NAD): what
is playing with its cover art, play and pause, next and previous, and the volume on a key or on a
Stream Deck + dial. It talks to one player over its local HTTP API and to nothing else.

Every paragraph here records a decision or a measured failure and the reason for it. The sibling
plugin at `../deadair/apps/streamdeck` settles most questions of shape, and its `CLAUDE.md` is worth
reading first; this file records only what is different here and why.

## The specification is normative, and it is not optional reading

The [BluOS Custom Integration API v1.7](https://bluos.io/wp-content/uploads/2025/06/BluOS-Custom-Integration-API_v1.7.pdf)
(April 2025) governs this plugin. Several of its rules are things a reasonable implementation gets
wrong, and three of them contradict what the popular third-party clients do. They are written out
here so nobody has to rediscover them.

**There is no JSON.** The word appears nowhere in the specification. No `Accept` header, no `format`
parameter, no JSON endpoint. Every response is XML. Parsing XML is not a preference.

**`title1`, `title2` and `title3` are what a UI must show.** The spec: "title1, title2 and title3
MUST be used as the text of any UI that displays three lines of now-playing metadata. Do not use
values such as album, artist and name." For two lines, "twoline_title1 & twoline_title2, if present,
MUST be used." A Stream Deck key is a two-line UI. Note that `pyblu`, which is the obvious thing to
copy, does the opposite and prefers `name`, `artist` and `album`. On a radio stream `title1` is the
station and `name` is whatever the stream announced, so the difference is visible, not academic.

**`secs` is deliberately left out of the etag.** "This value is not used in the calculation of etag
and progress will not of itself cause a return from a long-polling call. Clients are required to
increment the playback position." So a playhead is driven locally, by counting ticks rather than by
reading a clock, and a suspended process stalls the bar instead of jumping it.

**One long-poll is enough, and the spec says which.** `/Status` carries a `<syncStat>` element that
changes whenever `/SyncStatus` changes. So `/Status` is long-polled and `/SyncStatus` is read on
demand: on connect, on a change of player, on wake, and whenever `syncStat` moves.

**Polling rates are specified.** "A client must not make two consecutive requests for the same
resource less than one second apart, even if the first request returns in less than one second."
That is a MUST and it becomes a hard floor in the watcher, which is also what stops a missing etag
turning the read loop into a denial-of-service against somebody's stereo. For the `timeout`
parameter: "Recommended polling interval is 100 seconds and should be limited to a rate of 60
seconds or so and never faster than 10 seconds." This plugin asks for 60, which the spec names,
rather than 100: a dead socket is only discovered at the deadline, and a key that shows a confident
reading from an unplugged player is the thing the stale marker exists to prevent.

**`streamUrl` means next and previous do not exist.** Its presence says the play queue is not the
source, that shuffle and repeat are irrelevant, and that "next and previous are not available". On
internet radio those keys refuse the press rather than firing `/Skip` into nothing.

### Smaller traps, written down before they are rediscovered

**The mute parameter is documented backwards.** Section 3.1's table says "mute If set to 0, the
player is muted. If set to 1, the player is unmuted." Every example in the same document says the
opposite, and `/Status`'s own `mute` field is "Set to 1 if volume is muted". The table is an error.
Follow the examples: `mute=1` mutes.

**`volume` of `-1` means fixed volume**, on a line-out configuration. A dial pointed at such a player
says so and refuses, rather than writing values the device ignores.

**The volume range is configurable** (typically -80..0 dB, set in the Controller app) and every
command variant is "constrained to values that result in a level within the configured available
volume range". So a write can be clamped and reported back as a different number than was asked for.
Only user input may ever create an intended volume; a device report must never trigger a write, or
asking for 43 and being told 42 becomes an infinite loop against the stereo.

**Port 11000 is not universal.** "Port 11000 is used for all BluOS players, with the exception of
the CI580", which has four streamer nodes on different ports. Take the port from the mDNS SRV
record, and let a typed address carry `host:port`.

**The spec names two service types, not four:** `musc.tcp` and `musp.tcp`. The `musz` and `mush`
types come from third-party clients and are not in the specification. Appendix 13.1 documents LSDP
as an alternative discovery protocol, which is a note for later.

**Artwork can redirect.** "If the URL starts with /Artwork it may result in redirect. Adding a
parameter/key `followRedirects=1` when retrieving the image can avoid redirect."

**Commands answer with the new state**, so a key updates from the command's own response rather than
asking again. `/Play` resumes from pause but not from stop, and "play and stream should be
considered to have the same meaning".

## The bundle

**One ES module at `com.maroonedsoftware.bluos.sdPlugin/bin/plugin.js`, with `bin/package.json`
saying `{ "type": "module" }` beside it.** The Stream Deck app runs `CodePath` with its own Node (the
manifest asks for 24) and no `node_modules`, so tsup inlines everything and `noExternal` says so
whatever section a dependency is listed in. `bin/` is git-ignored and rebuilt from nothing, which is
why the build writes that `package.json` rather than the tree holding one.

**The bundle gives itself a `require`.** `ws`, which the Elgato SDK talks to the app through, is
CommonJS and calls `require('events')`, which an ES module does not have, and esbuild leaves those
calls in place. The banner in `tsup.config.ts` is `createRequire(import.meta.url)`. `bufferutil` and
`utf-8-validate` are left external on purpose: `ws` reaches for them inside a `try` and runs without.

**Decorators are OFF in `tsconfig.json`, and that is not a style choice.** The SDK's `@action` is a
standard (TC39) decorator, and `experimentalDecorators` types it as the legacy kind. Turning both
off is what lets `tsc` accept it and esbuild lower it.

**`pnpm pack` is pnpm's own tarball command** and wins over a script of that name, which is why the
script that builds the installer is called `installer`. It packs a copy of the plugin folder,
because `streamdeck pack` rewrites the manifest it packs in its own formatting and a local pack
should not leave the tree dirty.

**pnpm settings live in `pnpm-workspace.yaml`**, not in package.json, which pnpm 11 ignores with a
warning. `allowBuilds: esbuild: true` is required or tsup has no binary to run, and
`verifyDepsBeforeRun: false` is there because pnpm's pre-run check wants to purge `node_modules` and
cannot ask in a non-interactive shell.

## Running it

```bash
pnpm build        # tsc --noEmit, then tsup
pnpm test         # builds first, because two tests drive the BUILT bundle
pnpm typecheck    # tsc over tests and tools as well as src
pnpm lint
pnpm validate     # Elgato's validator; needs the network, see below
pnpm run installer
```

**`streamdeck validate` fetches the manifest's `URL` and `SupportURL`.** Until this repository exists
at `github.com/robert-dean/bluos` it fails with "URL must be resolvable" on a manifest that is
otherwise fine, which is why it is not part of `pnpm test`.

**The plugin must be launched from inside the `.sdPlugin` folder.** The SDK reads `manifest.json`
off the current working directory the first time an action is registered. Launched from anywhere
else it throws "Failed to read manifest.json as the file does not exist" before it opens a socket,
and because the SDK leaves the web socket's `onerror` unhandled, the only symptom is a silent exit
with status 0 and no output at all. That cost an hour on the first day. `tests/fixtures/fake.deck.ts`
sets `cwd` for this reason.

**After a build, restart the plugin, or the settings panel and the plugin disagree.** The app reads
`ui/*.html` and its script from disk every time a panel opens, but runs `bin/plugin.js` from the
moment it last started it. So a rebuilt linked plugin shows the new panel at once while the old
plugin answers it.

**On a Stream Deck, a linked plugin runs only in developer mode.** `streamdeck link` puts a symlink
in the app's Plugins folder; `streamdeck restart` is refused with "Feature only enabled in developer
mode" until `streamdeck dev` has turned that on. Installing the packed `.streamDeckPlugin` needs
neither.

## What is verified, and what is not

`tests/` mirrors `src/` and is kept out of the build tsconfig, so `tsc --noEmit` checks only what
ships. Two tests drive the real bundle through `tests/fixtures/fake.deck.ts`, a WebSocket server and
four command-line arguments, which is all the Stream Deck app is from the plugin's side. A test that
imported `src/` would pass while the bundle was broken, and the bundle is what ships.

`FakeDeck.faults` filters exactly one line out of the plugin's stderr: macOS writes "failed to copy
trust settings of system certificate" to the stderr of every process it starts when the machine's
trust store is in a state it dislikes. It arrives before Node runs a line of the plugin, and a test
asserting on raw stderr would fail on such a machine and pass in CI, which is the wrong way round.
Nothing else is hidden.

**Nothing has been read off a real player yet.** Every claim about the API above comes from the
specification. The open measurements are in the plan, and the first of them is whether
`/Status?timeout=60` honours 60 or clamps to 100.
