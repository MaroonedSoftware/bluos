# BluOS for Stream Deck

Control a BluOS player (Bluesound, NAD) from an Elgato Stream Deck.

- **Now playing** shows the cover, two lines of track information, and how far through it is.
- **Play or pause**, **next track** and **previous track** drive the transport.
- **Volume** turns the player up or down, or mutes it, from a key.
- **Volume dial** puts the volume on a Stream Deck + knob, with the cover on the touch strip.

Each key is pointed at a player by address, found for you on the network or typed in. Two keys can
name two different players, so a deck can hold the kitchen and the living room at once.

## Status

Early. The scaffold builds, registers with the Stream Deck app and is tested against the real
bundle; the keys themselves are being written. See `CLAUDE.md` for the decisions behind it.

## Building it

Requires Node 24 or later and the Stream Deck app 7.1 or later.

```bash
pnpm install
pnpm build
pnpm test
```

To run it on a deck, turn on developer mode once with `streamdeck dev`, then:

```bash
pnpm link
pnpm restart
```

## Licence

MIT.
