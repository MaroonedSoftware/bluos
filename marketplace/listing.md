# The Marketplace listing

What gets typed into Elgato's Maker Console, kept here so it is reviewed like anything else. The
pictures beside it in `media/` are drawn by `tools/preview/marketplace.media.ts` from the plugin's
OWN renderers, so the listing shows what a key actually draws rather than a mock-up that drifts from
it. Run `pnpm preview tools/preview/marketplace.media.ts` when a key changes and commit what it
writes. The covers in them are abstract shapes and the records made up, because a listing is no
place for somebody else's album art.

Two things the Maker Console will not let you change later: the plugin's UUID, and the product's
name once it has been submitted.

---

## Name

BluOS

## Short description

Control a Bluesound or NAD player from your Stream Deck.

## Description

See what your BluOS player is playing, with its cover art and how far through the track it is. Play
and pause, skip through a queue, and set the volume from a key or from a Stream Deck + dial.

Point each key at a player by picking it off the network or typing its address, so one deck can hold
the kitchen and the living room at once.

- **Now playing** — the cover, the two lines your player provides, and a progress bar. Turn either
  off for a key that shows only the artwork.
- **Play or pause** — shows whichever it will do next.
- **Next and previous** — and they say so plainly when the player is on a radio stream, where there
  is no next track to go to.
- **Volume** — up, down, or mute, with a step you choose. Hold a key to run.
- **Volume dial** — turn for the level, press to mute, tap the screen to play or pause, with the
  cover on the touch strip.

It talks to your player directly over your own network. There is no account, no cloud service, and
nothing to sign in to.

## Category

Music

## Requires

A BluOS player on the same network: Bluesound, NAD, PSB, Dali, and others. Stream Deck 7.1 or later.

---

## Gallery

| File                              | Shows                                               |
| --------------------------------- | --------------------------------------------------- |
| `media/thumbnail.png`             | The thumbnail                                       |
| `media/gallery-1-now-playing.png` | Now Playing keys, with and without the title        |
| `media/gallery-2-transport.png`   | The transport keys beside a Now Playing key         |
| `media/gallery-3-volume.png`      | The three volume keys and the player they belong to |

The `.svg` beside each `.png` is the source. The PNGs are rasterised by macOS's own `qlmanage` and
`sips`, which is why the generator draws on a square canvas and crops: `qlmanage` fits an SVG into a
square thumbnail, and what it does with a 2:1 canvas came out scaled and offset.
