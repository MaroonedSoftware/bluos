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
and pause, skip, switch inputs, start a preset, and set the volume from a key or from a Stream Deck +
dial, with a maximum so nothing turns the room up further than you want.

Point each key at a player by picking it off the network or typing its address, so one deck can hold
the kitchen and the living room at once.

- **Now playing**: the cover, the two lines your player provides, and a progress bar. Turn either off
  for a key that shows only the artwork.
- **Now playing strip** (Stream Deck +): put it on all four dials for the cover, the track, the player
  and the time across the whole touch strip. Turn to skip, press to play or pause.
- **Play or pause**, **Next** and **Previous**: on a radio stream, next and previous use the station's
  own skip where it has one, and say so plainly where it does not.
- **Presets**: each key shows the preset's own name and artwork. Or step through them all.
- **Inputs**: optical, HDMI, a turntable. The key lights up while its input is playing.
- **Volume**: up, down, mute, or straight to a level, with a step you choose. Hold to run.
- **Volume dial** (Stream Deck +): turn for the level, press to mute or to play and pause, with the
  cover on the touch strip.
- **Maximum volume** on every volume key and dial, so one fast turn cannot take an amplifier too far.
- **Shuffle**, **Repeat** and **Love**, where the source supports them.

It talks to your player directly over your own network, on Mac and Windows. There is no desktop app to
keep running, no account, no cloud service, and no charge for more than one player.

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
