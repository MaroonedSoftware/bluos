# BluOS for Stream Deck

Control a BluOS player (Bluesound, NAD) from an Elgato Stream Deck.

- **Now playing** shows the cover, two lines of track information, and how far through it is.
- **Now playing strip** spreads the same across all four dials of a Stream Deck +.
- **Play or pause**, **next** and **previous** drive the transport, using a radio station's own skip
  where it offers one.
- **Preset** plays one of the player's presets, showing its name and artwork.
- **Input** switches to optical, HDMI and so on, and lights up while its input is playing.
- **Volume** turns the player up or down, mutes it, or sets a level, from a key.
- **Volume dial** puts the volume on a Stream Deck + knob, with the cover on the touch strip.
- **Shuffle**, **repeat** and **love** where the source supports them.
- **Stop** and a **sleep timer**. BluOS has no power command; a stopped player goes into standby on
  its own, and any preset or input key wakes it.

Every volume control can be given a maximum.

Each key is pointed at a player by address, found for you on the network or typed in. Two keys can
name two different players, so a deck can hold the kitchen and the living room at once.

## Status

Working, and tested on a Stream Deck + against an NAD M10 V2. See `CLAUDE.md` for the decisions
behind it, including what has and has not been checked on real hardware.

## Building it

Requires Node 24 or later and the Stream Deck app 7.1 or later.

```bash
pnpm install
pnpm build
pnpm test
```

To run it on a deck, turn on developer mode once, then link it:

```bash
pnpm deck:dev
pnpm deck:link
```

After every build, reload the running plugin, or the settings panel and the plugin disagree:

```bash
pnpm deck:restart
```

## Releasing it

A change worth a release gets a changeset:

```bash
pnpm changeset
```

Merging the version pull request that opens is the whole of cutting a release. CI tags it, builds
the installer and publishes it on a GitHub release. Edit the package's version, never the manifest's:
`pnpm release:version` mirrors one into the other and CI fails when they disagree.

Uploading to the Elgato Marketplace is the one step left by hand. `marketplace/listing.md` holds the
text and the pictures it takes.

## Licence

MIT.
