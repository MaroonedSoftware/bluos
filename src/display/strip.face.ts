import type { Playhead } from './playhead.js';

/** How many dials the panel spans. A Stream Deck + has four. */
export const SLICES = 4;

/**
 * What one dial's quarter of the panel can be told, keyed as `layouts/strip.json` names its items.
 *
 * Every value is either the item's value or an object that also switches it on and off, because the
 * four quarters share one layout and each shows only the items it uses.
 */
export interface StripFrame {
    cover?: { value?: string; enabled: boolean };
    line?: string;
    sub?: string;
    bar?: { value: number; enabled: boolean };
}

/** Everything the panel shows, worked out once and then cut into quarters. */
export interface StripView {
    /** The cover as a raster data URI, which is what a layout `pixmap` is known to draw. */
    cover?: string;
    firstLine?: string;
    secondLine?: string;
    /** The player's own name. */
    player?: string;
    /** What the player is doing, in a word or two. */
    doing?: string;
    playhead?: Playhead;
    /** A stream, which has no length: the time quarter says Live rather than a number. */
    live: boolean;
    /** Why there is nothing to show, when there is nothing: "No player", "No answer". */
    failure?: string;
}

/** Seconds as `m:ss`, or `h:mm:ss` past an hour. */
export function clock(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    const s = String(whole % 60).padStart(2, '0');
    const m = Math.floor(whole / 60) % 60;
    const h = Math.floor(whole / 3600);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * How much of one quarter's bar is filled, out of 100.
 *
 * The four bars read as one line along the bottom of the whole strip: the first fills over the first
 * quarter of the track, then the second starts, and so on. A quarter the track has not reached is
 * empty, and one it has passed is full.
 */
export function barShare(fraction: number, slice: number, slices = SLICES): number {
    return Math.round(Math.min(1, Math.max(0, fraction * slices - slice)) * 100);
}

/**
 * One dial's quarter of the panel.
 *
 * Left to right: the cover, then what is playing, then which player and what it is doing, then the
 * time. The dial's column decides which, so a panel dragged onto all four dials reads left to right
 * whatever order it was placed in. A dial beyond the fourth wraps round, which on a wider deck
 * starts the panel again rather than leaving a blank dial.
 */
export function stripSlice(column: number, view: StripView): StripFrame {
    const slice = ((column % SLICES) + SLICES) % SLICES;
    const bar = view.playhead === undefined ? { value: 0, enabled: false } : { value: barShare(view.playhead.fraction, slice), enabled: true };

    if (view.failure !== undefined) {
        // A failure is said once, where the title would be, not four times across the strip.
        return { cover: { enabled: false }, line: slice === 1 ? view.failure : '', sub: '', bar: { value: 0, enabled: false } };
    }

    switch (slice) {
        case 0:
            // With no cover, this quarter names the player instead of standing empty.
            return view.cover === undefined
                ? { cover: { enabled: false }, line: view.player ?? '', sub: '', bar }
                : { cover: { value: view.cover, enabled: true }, line: '', sub: '', bar };
        case 1:
            return { cover: { enabled: false }, line: view.firstLine ?? '', sub: view.secondLine ?? '', bar };
        case 2:
            return { cover: { enabled: false }, line: view.player ?? '', sub: view.doing ?? '', bar };
        default: {
            if (view.live) return { cover: { enabled: false }, line: 'Live', sub: view.doing ?? '', bar };
            const playhead = view.playhead;
            return playhead === undefined
                ? { cover: { enabled: false }, line: '', sub: '', bar }
                : { cover: { enabled: false }, line: clock(playhead.elapsedSeconds), sub: `of ${clock(playhead.totalSeconds)}`, bar };
        }
    }
}
