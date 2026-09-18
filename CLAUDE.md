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

**`streamUrl` means the queue is not the source, and next and previous come from the station
instead.** The specification's line is "next and previous are not available (but see also
actions)", and the part in brackets is the point. Section 4.8: a streaming station that can skip,
go back, love or ban says so with `<action name="skip" url="...">` elements in `/Status`, and the
client asks that URL. An `<action>` with no `url` is the station saying that one is NOT available.
An earlier version of this plugin quoted the line without its brackets and refused Next on every
stream, including stations that would have skipped; the review of other plugins is what found it.
Now the keys ask `/Skip` and `/Back` on a queue, the station's URL on a stream that offers one, and
refuse only a stream that offers nothing.

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

## What the keys do

**Absolute commands only, everywhere.** `/Pause?toggle=1` exists and is never used. The state is
known from the reading, so a key issues the verb it means, and a double press or a retry can never
invert what it asked for. The same rule settles the volume, which is written as a level and never as
a relative step, and the measured evidence for that is in the section above: the level round-trips
exactly where the dB drifts.

**A command's own answer flips the key.** Every BluOS command answers with the state it produced, so
`StatusWatcher.command` folds that into the reading and publishes it. The key moves the moment the
player agrees rather than a round trip later, and there is no follow-up read schedule of the kind
the sibling plugin needs. It folds in only what the answer carried, and does nothing at all before
the first reading has arrived, because inventing one would have a key drawing a track it has never
been told about.

**Next and Previous refuse a press only on a stream that offers nothing.** On a stream they ask the
station's own skip or back URL when it offers one (see the specification section above). Where it
does not, as with the TuneIn stream the player this was built against was on, a Stream Deck key
cannot be greyed out, so it says "Stream" on its face, takes the press, and declines it. Doing
nothing at all would read as the plugin being broken.

**A stale reading refuses a press too.** A reading from before the player stopped answering says
nothing about what a press would do now.

**There is no arming.** The sibling plugin's Stop arms on the first press and fires on the second,
because it guards a live radio station going off air. Nothing here is that: pausing a speaker is
undone by pressing again.

**Play from a stopped player is reported rather than hidden.** The specification: "/Play can be used
to resume when in a pause state but not when in stop state." A stopped player has nothing loaded, so
the log says to choose something in the BluOS app first.

## The now-playing strip

**One action placed on all four dials, each drawing the quarter its column says**: the cover, then
the track, then the player and what it is doing, then the time, with one progress bar running along
the bottom of all four. Nothing coordinates the four. They read the same player through the same
watcher and cut the same view, so they agree, and four dials still cost one long-poll. The quarter
comes from the dial's column rather than the order it was placed in, so the panel reads left to right
however it was dragged on, and a fifth dial on a wider deck wraps round to the start.

**It is built only from what is known to draw on a Stream Deck +.** The cover goes into a layout
`pixmap` as the raw raster the cover cache produces, which was measured on the device on 2026-09-18.
The composed SVG a key draws has never been tried in a pixmap and is not used. Everything else is the
layout's own text and bar items, switched on and off per quarter with `enabled`, because the four
share one layout.

**The painter now compares feedback by its JSON.** A value can be an object that also switches an
item on or off, and two equal objects are never the same object, so comparing by identity would have
sent every quarter's whole payload on every half-second tick.

**Turning skips a track, with a 700 ms guard after each skip.** One detent is one track, and a dial is
easy to brush, so without the guard a knocked knob could run through half an album. It uses the same
`skipTarget` as the Next and Previous keys, so a station's own skip works here too. Pressing or
tapping plays or pauses. The volume stays on the volume dial, which is why turning does not do it.

**A failure is said once, in the title quarter**, rather than four times across the strip.

**The manifest test checks every dial layout against the code that fills it**, reading each frame
interface's fields from the source to its closing brace. The strip's frame has nested object types,
which the first version of that pattern would have cut short at the first `}`; it was checked by
adding a bogus field and watching it fail.

## Finding players

**The browse runs in the PLUGIN process, and it has to.** The settings panel is a Chromium page
with no `dgram`, no raw sockets and no multicast. Writing that down because it is exactly the thing
somebody will later try to simplify by moving it into the panel.

**Two service types, `musc` and `musp`, because those are the two the specification names.** The
`musz` and `mush` types that some third-party clients browse are not in it. Appendix 13.1's LSDP is
the documented alternative if these ever fail.

**Every find is confirmed with `/SyncStatus` before it is offered.** An mDNS answer says something
is there; only the player's own response says what it IS, gives it the name its owner chose, and
reveals that it has never been set up. The port comes from the answer rather than being assumed,
because port 11000 is not universal.

**The browser is never left running.** It holds a multicast socket and goes on answering the whole
network's queries, so it browses for five seconds and stops, and stops again when the panel closes.

**The list and the address field are ONE setting.** Choosing from the list fills the field in, and
the field is what a key uses. There is no auto-or-manual mode, which kills the whole class of "I
picked a device but it is still using the old address" confusions, and it meant discovery was purely
additive to a field that already existed.

**A network that filters multicast is a normal path, not an exception.** IoT VLANs, client isolation
and several mesh routers block it. Finding nothing is explained in words and the manual field is
always there, and "the browse ran and heard nothing" is worded differently from "the socket would
not open", because those are fixed in different places.

**`DiscoveredPlayer` is a type alias rather than an interface**, and not as a matter of taste: it is
sent through `sendToPropertyInspector`, which takes a JSON value, and an interface does not satisfy
an index signature. The settings types are aliases for the same reason.

## Presets

**A preset key draws the preset's own name and artwork**, which is the point of it over one that
merely says "Preset 3": the v1.7 specification added `image` to each preset for exactly this. The
image is an absolute URL or an `/Artwork` path on the player, and goes through the same resolver and
cover cache as a Now Playing key.

**The list is read once per player, and again only when `/Status` says it moved.** `<prid>` in
`/Status` matches `prid` on `/Presets` and changes whenever the presets do, so the long-poll every key
already has is what says a preset was renamed or deleted. There is no timer.

**A key saved with a preset that has since been deleted says so, and refuses the press** rather than
firing an id the player no longer knows. It only refuses once the list has actually arrived: before
that the player is the better judge, and answers an unknown id with an error the key reports anyway.
The settings panel keeps that choice visible as "no longer on the player" rather than silently
showing a different one.

**Next and previous are the specification's `id=+1` and `id=-1`**, which loop round the player's
presets at either end, so two keys can step through all of them. The `+` goes as `%2B`, because a
bare `+` in a query string is a space.

**The panel's preset list comes from the plugin.** The panel is a Chromium page and cannot reach the
player, the same reason discovery runs in the plugin, so the panel asks and the plugin reads the list
and sends it back.

## Inputs

**An input key uses the specification's Active Input Selection (section 11.1)**: the inputs come from
`/RadioBrowse?service=Capture` and each is played with `/Play?url=` and the URL it was listed with. The
specification offers two other methods keyed on firmware version; this is the one it says also works
for a BluOS HUB's inputs, and it needs no knowledge of which firmware is running.

**Each input's URL arrives already percent-encoded, and is decoded on reading.** `URL="Capture%3Abluez%3Abluetooth"`
passed straight to a query builder would be encoded again and reach the player as `%253A`. Decoded
once when read and encoded once when sent, it arrives as the player wrote it. A test pins the exact
request, because this is the kind of bug that fails silently on a real player and nowhere else.

**Only physical inputs are listed.** The same response carries streaming services such as Spotify,
which have no `inputType`, and a key that says "Input" should not quietly start a cloud service.

**The key outlines itself while its input is playing**, which `/Status` reports as `inputId`, so a
row of input keys reads like the selector on the front of an amplifier. Inputs change rarely and
nothing in `/Status` says when they do, so the list is read once per player, and once more when a key
asks for an input the list does not have.

## Shuffle, repeat and love

**Shuffle and repeat only mean something on a queue.** The specification: with a `streamUrl`,
"shuffle and repeat are not relevant and should be removed from any UI if possible". A key cannot be
removed or greyed out, so it says "Stream" and declines the press, as Next does on a station that
offers nothing.

**The repeat numbering is the player's, and it is not the obvious one**: 0 repeats the whole queue,
1 repeats one track, 2 is off. The manifest's three states are in that same order so the reported
value is the state index. A press steps off, queue, track, off. A test pins every value.

**Both send the state they mean, never a toggle**, from what the player last reported, and both
update from the command's own answer: `/Shuffle` and `/Repeat` answer with a `<playlist>` element
carrying the new state as an attribute, which the client reads and the watcher folds in.

**Love uses the station's own URL**, the same `<actions>` block that lets Next skip on a stream. Most
sources offer nothing of the kind, and the heart goes faint to say so before it is pressed. Ban, the
same section's other action, is deliberately not offered: it skips the track and tells the service
never to play it again, which is too much to hang off a key pressed without looking.

## A maximum volume

**Every volume control can be capped, and it is a safety limit rather than a preference.** On an
amplifier, one fast turn of a dial or a held key can take a room somewhere nobody wanted it. The
repeat ceiling limits how LONG a key runs; this limits how loud anything gets. HiFi Control, the
only other BluOS plugin on the Marketplace, has one, and it was the second thing the review of
other plugins turned up.

**The cap limits only what this plugin asks for.** A level somebody set from the BluOS app is left
alone, and pressing "up" above the cap does nothing rather than pulling the room down to it, because
"up" must never make things quieter. Down is a step down from wherever the level is: clamped to the
cap instead, one press from 70 with a cap of 40 dropped the room to 40, which a test caught.

## The dial

**`PlayerKeys` is generic over the control, and `KeyControls` adds the painter.** A dial and a key
share only the fact that they follow a player. The SDK makes the same split: a dial has
`setFeedback` and no `setState`, and it has `showAlert` but no `showOk`, because the tick is drawn
on a key face a dial does not have. So `ControlFace` holds what both are sure to have, and the
painter lives one layer down where there is a key to paint.

**The model and the writer are shared with the volume key, and that is the point of them.** They
have no HTTP and no SDK in them, so the coalescing, the settle window and the rule against chasing a
rounded level are written and tested once, and both shells stay thin.

**Two things stand between a spun encoder and Elgato's ten-updates-a-second guideline.** Diffing,
because `setFeedback` MERGES, so a payload carrying only what moved is both correct and much
smaller. And a throttle, because diffing alone does not help during a spin: every field genuinely
changes on every tick. The throttle keeps a trailing send, because a dial that stopped one frame
short of where the knob was left would be worse than one that lags.

**A press-and-turn must not mute the player.** The gesture delivers `dialDown`, then rotations, then
`dialUp`, and press-and-turn is the go-faster gesture, so muting on release would mute the player
every single time somebody used it. `PressWatch` cancels the release when a rotation happened in
between. Its own file with its own test because it is small, pure, and the kind of thing that is
silently wrong for weeks.

**A key passed to `setFeedback` that the layout never declared fails silently**: nothing errors and
nothing draws. So `tests/manifest.test.ts` reads the frame's field names out of `dial.face.ts` and
checks the committed layout declares each one, rather than comparing against a list written twice
and left to drift. It was checked by adding a bogus field and watching the test fail.

**The strip's icon is the raw cover**, a raster data URI as the artwork cache already produces it,
rather than the composed SVG a key draws. **Measured on a Stream Deck + on 2026-09-18: it draws.** A
raster data URI in a layout `pixmap` is now known to work. What is still unmeasured is narrower: the
composed SVG, a raster embedded through `xlink:href` inside an SVG inside a `pixmap`. The sibling
plugin proved that nesting only in `setImage` on a key. So the composite remains an upgrade, and the
first step of it is trying it on the device.

## Every key holds its own player

**`PlayerKeys` departs from the sibling plugin's `StationKeys`, and this is the largest structural
difference between the two.** That one acquires the poller ONCE, on the first key of an action,
because one API key meant one station and every key necessarily watched it. Here the address is a
per-key setting, so two Now Playing keys may name two different players. The hold is therefore per
key: its own watcher, its own subscription, its own reading, and a `render(id)` that draws one key
rather than all of them.

Six keys on one player still cost one long-poll, because the pool hands them the same watcher. What
changed is who holds it, not how many there are.

**A key adopts the default by WRITING it into itself**, through `KeyFace.setSettings`. That method is
on the face rather than reached for through the SDK because the SDK has no way to find an action by
its id: settings are written through the action object, and the face is the only handle a key class
has on one. The write comes back as `didReceiveSettings`, which is what really re-points the key;
pointing it locally as well is what makes it draw now instead of a round trip later.

**Subscribing hands over the current reading at once**, so a second key on a player somebody is
already watching draws immediately rather than sitting on the manifest's own picture until the next
change.

**Each key remembers its own settings, so a change to the default re-points keys without asking
the app for anything.** It used to ask: the global-settings handler fetched every key's settings
behind an `await`, then re-pointed whichever keys existed once the answers came back. A key that
appeared in between had no answer, was treated as having no settings, and followed the DEFAULT
instead of its own player. With one player that shows as "No player"; with two it is worse, because
a Kitchen key silently shows Office. On a deck the window is startup, when the app sends
`willAppear` for every visible key at about the same moment as the global settings. It surfaced as a
one-in-six flake under Node 22 and a test now forces the interleaving: it failed three times out of
three before the fix. The handler is synchronous now, which removes the race rather than narrowing it.

**A subscription checks it is still the right one before it draws.** A key that moves to another
player while a reading is in flight would otherwise take the old player's answer.

## The settings, and the panel

**Which player a key talks to is an ACTION setting, not a global one, and this is the one place the
sibling plugin's shape is deliberately inverted.** It keeps its settings global because an API key
acts as the account that issued it and Elgato writes an action's settings in plain text into every
profile somebody exports. BluOS has no credential at all, so the reason is gone, and the opposite
need arrives in its place: four dials on a Stream Deck + are naturally four rooms, and a global
address would make that impossible. Do not "restore consistency" with the sibling here.

**One thing is global, and it is a convenience rather than a source of truth**: `defaultAddress`,
the last player chosen in any panel, so a freshly dragged key works before anybody opens it. A key
that appears without an address ADOPTS it by writing it into its own settings, rather than falling
back quietly at the moment of use. Then a key's settings describe the key truthfully, the panel
needs no special case for "inherited", and a profile somebody exports carries the player it was
actually using.

**The panel never sends the settings to the plugin.** It writes them with `setSettings`, the app
delivers them, and the plugin checks what it was handed, so what the panel shows is about the
settings the keys are actually using rather than about what the panel believes it typed. The sibling
plugin reached the same rule for global settings; the only difference here is which message the app
delivers.

**The check asks `/SyncStatus`, and answers with the player's NAME.** "It connected" is worth very
little when half the addresses on a home network answer something. Naming the player back is the
only answer that proves the right box was reached. A player answering `initialized="false"` is
reported as needing setup rather than as connected.

**The panel is written here, not taken from `sdpi-components`.** Elgato suggests that library, and
the sibling's reasons hold: the npm package of that name is not its author's, the protocol is six
messages, and a TypeScript panel shares the address parser and the message types with the plugin
that answers it. `src/inspector/` is built by tsup into `ui/player.js` beside the committed page.

**A test harness note that is easy to get backwards.** In the Stream Deck app the property inspector
has its OWN socket to the app, so a `setSettings` from the panel reaches the APP, which then tells
the plugin. `FakeDeck.panelWrites` models that. Sending `setSettings` down the plugin's own socket
would be backwards and would quietly test nothing.

**Waiting for "the first frame" is almost always the wrong wait, and it has now cost two
debugging sessions.** A key draws the instant it appears, from a reading it does not have yet, so
the first `setTitle` is "No player" and the first `setState` is whatever an empty reading implies.
Waiting for either matches that frame and proves nothing; in the transport test it let a press land
ten milliseconds after `willAppear`, before the player had answered anything, and the refusal that
followed was correct behaviour being reported as a bug. Wait for the frame that can only come from a
reading: a specific state, or a title the player supplied.

`FakeDeck.next` searches what has already arrived, which is usually right and part of the same trap.
Pass `from`, taken from `deck.mark` before the thing under test, to wait for a genuinely new message.

**Every launched plugin gets its own working directory, and that is the fix for a flake that was
twice mistaken for a timeout.** The SDK rotates its log files on startup by renaming each to the
next number. Vitest runs files in parallel, so two plugins starting at once both try to rename the
same file, one loses with `ENOENT: rename ...8.log -> ...9.log`, and that process DIES before it
ever connects. From the test's side it is indistinguishable from a slow start, which is why raising
the timeout appeared to help and did not. `FakeDeck` now copies `manifest.json` into a throwaway
directory and launches from there. It also keeps test runs out of the log of whatever real plugin
happens to be installed, which they were quietly polluting.

**A `FakeDeck` timeout reports what the plugin said, not just that it spoke.** "setTitle, setTitle"
says a key drew twice; `setTitle(""), setTitle("No player")` says it lost its player, which is what
turned an unexplained flake into the race described above.

**The bundle tests still have generous timeouts**, because a Node process starting while sixteen
other test files run is genuinely slow. `testTimeout` is 20 seconds and `FakeDeck`'s own is 15,
deliberately shorter, so a failure comes from the harness with a list of what the plugin actually
said rather than as a bare "test timed out".

**The end-to-end panel test serves a real player on loopback.** The bundle runs in its own process
and cannot be handed a fake `fetch`, so `tests/fixtures/serve.player.ts` answers real HTTP with the
bytes a real M10 sent. That proves the same bytes the unit tests parse also survive the bundle, the
socket and the panel. Loopback is the only network a sandboxed test run has, and it is enough.
Do not write a test that needs the real player: it would pass on one machine and fail everywhere.

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

**Three of the obvious script names are pnpm's own commands, and pnpm wins.** `pnpm pack` is its
tarball command, `pnpm link` is its global-link command, and `pnpm restart` is a lifecycle wrapper
that runs stop, restart and start. A script of any of those names is shadowed: `pnpm link` reports
"The configured global bin directory is not in PATH" and never reaches `streamdeck link` at all.

`pnpm run link` would work, but a name that only works when you remember a word is a trap. So the
scripts are named to avoid the collision outright: `installer` builds the packed plugin, and the
three that drive the Stream Deck app are `deck:link`, `deck:restart` and `deck:dev`. The sibling
plugin renamed `pack` for this reason and left `link` alone, which is the bug this inherited.

`installer` packs a COPY of the plugin folder, because `streamdeck pack` rewrites the manifest it
packs in its own formatting and a local pack should not leave the tree dirty.

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
pnpm installer    # builds the packed .streamDeckPlugin

pnpm deck:dev     # turn on developer mode, once per machine
pnpm deck:link    # symlink the plugin folder into the Stream Deck app
pnpm deck:restart # reload the running plugin after a build
```

**CI has been run locally, step by step, before it ever ran on GitHub.** `actionlint` passes on
both workflows (it is installed here), and every step of `build.yml` exits 0 in order. The suite
passes under Node 22 and Node 26, which bracket the runner's 24. `packageManager` in package.json is
what tells `pnpm/action-setup` which pnpm to install; without it, or a `version:` on the action, the
first run fails with "No pnpm version is specified". Setting both is also an error, so it is only
the field.

**`streamdeck validate` fetches the manifest's `URL` and `SupportURL`**, which is why it is not part
of `pnpm test`. Two different things come of that, and they were conflated once already:

- **In a sandboxed session it ERRORS** with "URL must be resolvable" on a manifest that is perfectly
  fine, because the validator cannot reach the network at all. A URL that `curl` fetches with a 200
  fails this way too, which is what gives the game away.
- **With the network it WARNS**, "URL should return success (received 404)", because
  `github.com/maroonedsoftware/bluos` does not exist yet. A warning, so `validate` and `installer` both
  succeed, and the warning goes when the repository is pushed.

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

### On a Stream Deck

Robert ran it linked, in developer mode, against Office (the NAD M10 V2 below) on 2026-09-18, and
reports that it works. Everything before that date was checked against fakes, a loopback player
serving bytes captured from the M10, and the built bundle driven through `FakeDeck`.

**The cover draws on the dial's touch strip**, confirmed by Robert on the same day. That was the one
rendering path no fake could settle and the sibling plugin never measured: a raster data URI in a
layout `pixmap`.

Still not confirmed: the packed `.streamDeckPlugin` installed by double-click rather than linked.

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

**`/Volume?level=N` comes back as exactly N.** Asking for 19 answered
`<volume db="-56.8" offsetDb="0" mute="0" etag="..." source="">19</volume>`. Nothing is clamped at
this player's configured range, so a write can be treated as confirmed rather than chased. The guard
against chasing a clamped value stays anyway, because the range IS configurable and a player set up
differently could round; it costs nothing and the failure it prevents is an infinite write loop
against somebody's stereo.

That answer also settles **why the volume is written as a level and never as dB**: `/Status` reported
`db="-56.7"` at volume 19, and setting level 19 answered `db="-56.8"`. The level is exact and the dB
is derived and drifts. And note the etag on that response belongs to the **volume** resource, not to
`/Status`; feeding it into the status chain would be a quiet mistake.

**Real captures are in the fixtures.** `REAL_STREAM_STATUS` and `REAL_SYNC_STATUS` in
`tests/fixtures/bluos.xml.ts` are byte for byte what the M10 sent. They caught three things the
constructed fixtures did not: the player sends `<sleep></sleep>` where the specification prints
`<sleep/>`, it carries fields the specification never documents (`currentImage`, `serviceName`,
`serviceType`, `class`, `hasSubwoofer`), and its `/SyncStatus` has nested children where the
specification's example has only `<master>` and `<slave>`. All of which is the case the
specification means by "Undocumented responses should be ignored".

The shapes still written from field descriptions rather than captured, because the one player to
hand is not doing them: a queue-backed track with a length, a muted player, a fixed output, and a
group.

`node tools/capture.mjs <address>` asks a real player the questions the design rests on and prints
what it finds: whether a requested long-poll `timeout` is honoured or clamped to 100, what an etag
actually looks like and whether it needs encoding, whether `twoline_title1` is present on the
services in use, and what content type the player serves its own artwork with. It is read-only, so
it is safe to run while somebody is listening. `--write` also saves the responses under
`tests/fixtures/captured/`, which is git-ignored; promote one into `bluos.xml.ts` to keep it.

The two questions it cannot answer without writing to the player, and which still need doing by
hand in an empty room: whether `/Volume?level=N` reports back exactly N or clamps it to the
configured dB range, and whether `/Status` bumps its etag promptly when the volume moves.
