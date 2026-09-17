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

## One watcher per player, long-polled

**The keys never ask a player anything themselves.** They subscribe to a `StatusWatcher`, and
`WatcherPool` keeps one per player address. The sibling plugin has a single poller and is right to:
one API key meant one station, which is why its settings are global. Here there is no credential, so
the address is a per-key setting, and four dials on a Stream Deck + are naturally four rooms. Six
keys on one player still cost one long-poll.

**`/Status?timeout=60&etag=...` replaced the timer, and nothing else changed.** The sibling's notes
name this as the seam a feed would fill: "a feed replaces the poller's timer and nothing else". The
interface a key sees is the same.

**A read that comes back with an unchanged etag is a success that publishes nothing.** This has no
counterpart in the sibling and it is the thing that fails quietly. Publish on every answer and a key
flickers through identical frames. Treat an unchanged answer as "nothing happened" and the backoff
never resets, so a healthy player degrades to thirty-second polling and a key that went stale never
comes back. `markAlive` runs on every answer and `publish` only when something moved.

**A failure drops the etag, and that is not tidiness.** Retrying WITH it asks the player to hold
until something changes, so a player that came back while still playing the same track would hold
the socket for the full sixty seconds with every key showing a stale reading. A test caught this.
Without an etag the next read answers at once, which both proves the player is back and brings
whatever changed while it was away. `refresh()` does the same thing after the machine wakes, for the
same reason plus one more: a player that rebooted may have reset its etags entirely.

**One second is the floor between reads, unconditionally.** The specification makes it a MUST. It is
also the only thing standing between an etag that fails to chain and an unthrottled request loop
against somebody's stereo, because the success path is a loop with no timer in it. It is measured
from when the last read STARTED, which is what "two consecutive requests" means.

**A release lingers for two seconds.** A Stream Deck page change fires `willDisappear` for every key
and `willAppear` for the next page's a few milliseconds later. Without the pause every page flip
tears the socket down and costs a round trip with a visibly blank key. The sibling never noticed
because its two-second tick hid it.

**An in-flight read is ABORTED, not just discarded.** The sibling drops a late answer with a
generation counter, which is enough at a ten-second deadline and not at a sixty-second one: a
released watcher would hold a socket for a minute. The generation counter stays as well, for the
race where an answer lands between the abort and the rejection.

**There is no follow-up read after a command.** The sibling fires three timers because its station
had no push channel. Here every command answers with the state it produced, and the long-poll wakes
within milliseconds of the change anyway.

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

### Measured on a real player

Against an **NAD M10 V2** named "Office" at 192.168.1.234, on 2026-09-17, with `tools/capture.mjs`:

**`/Status?timeout=60` is HONOURED.** It held for exactly 60 seconds and then answered. The player
does not clamp a requested timeout up to the recommended 100, so the watcher asks for 60 and gets
60, and the read deadline of 68 seconds is right. This was the assumption the whole shape of the
watcher rested on.

**An etag is 32 hexadecimal characters** (`d3e4e18ba70a27b2600daa1ac2622ad5`), so it needs no URL
encoding. It is still passed through `URLSearchParams`, because a firmware that changed its mind
about that should not become a bug here.

**`twoline_title1` is present**, so the two-line titles are the ordinary path rather than the
fallback. Following the specification rather than copying `pyblu` was not academic.

**A stream reports `secs` without `totlen`.** The capture caught the player 9,125 seconds into an
internet radio stream with no total length at all, which is `secs` counting time on the stream
rather than a position in a track. A playhead that guessed a bar from `secs` alone would draw a
meaningless one, and this is the ordinary case rather than an edge one.

**Artwork can be absolute and off-player.** This player's current source serves art from its own
HTTPS origin rather than from the player, so the relative `/Artwork` path is not the only shape to
handle. The URL carried a track id, so it changes per track; a station that reuses one URL for the
whole session is still the case the cover cache's title-discriminated key exists for.

`/SyncStatus` answers `application/xml` in 20ms, and `/Status` in 3ms.

**Still to measure, because they write to the player.** Both want an empty room:

```bash
curl -s 'http://192.168.1.234:11000/Volume?level=19'   # does it answer with exactly 19?
curl -s 'http://192.168.1.234:11000/Status' | grep -o 'etag="[^"]*"'   # before and after a volume change
```

**The fixtures are still mostly constructed.** Everything in `tests/fixtures/bluos.xml.ts` beyond
the two transcribed specification examples was written from field descriptions rather than
captured.

`node tools/capture.mjs <address>` asks a real player the questions the design rests on and prints
what it finds: whether a requested long-poll `timeout` is honoured or clamped to 100, what an etag
actually looks like and whether it needs encoding, whether `twoline_title1` is present on the
services in use, and what content type the player serves its own artwork with. It is read-only, so
it is safe to run while somebody is listening. `--write` also saves the responses under
`tests/fixtures/captured/`, which is git-ignored; promote one into `bluos.xml.ts` to keep it.

The two questions it cannot answer without writing to the player, and which still need doing by
hand in an empty room: whether `/Volume?level=N` reports back exactly N or clamps it to the
configured dB range, and whether `/Status` bumps its etag promptly when the volume moves.
