import type { StatusReading } from '../bluos/status.reading.js';

/** How often a key redraws to move the bar while a track plays. */
export const TICK_MS = 500;

export interface Playhead {
    elapsedSeconds: number;
    totalSeconds: number;
    /** 0 to 1. */
    fraction: number;
}

/**
 * How far through the track is, carried forward from the last reading.
 *
 * Carrying it forward is not an optimisation, it is the specification's instruction: "`secs` is not
 * used in the calculation of etag and progress will not of itself cause a return from a long-polling
 * call. Clients are required to increment the playback position, when state is play or stream, based
 * on the interval since the response." A long-poll that only answers when something CHANGES would
 * otherwise leave the bar frozen for the length of a track.
 *
 * It **refuses to guess**. No `totlen` means no bar, and that is the ordinary case rather than an
 * edge one: the player this was built against was on an internet radio stream, which reported `secs`
 * of 9,696 and no total length at all. A bar drawn from `secs` alone would be a confident lie about
 * a thing that has no end.
 */
export function projectPlayhead(status: StatusReading | undefined, carriedMs: number): Playhead | undefined {
    const totalSeconds = status?.totlen;
    const reported = status?.secs;
    if (status === undefined || totalSeconds === undefined || reported === undefined || totalSeconds <= 0) return undefined;

    // Only a playing track advances. A paused one sits where the player left it.
    const carried = status.playing ? carriedMs / 1000 : 0;
    const elapsedSeconds = Math.min(totalSeconds, Math.max(0, reported + carried));
    return { elapsedSeconds, totalSeconds, fraction: elapsedSeconds / totalSeconds };
}

/**
 * How far the clock has been carried past the last reading, counted in ticks.
 *
 * Ticks rather than a wall clock, as in the sibling plugin: a process the system suspends
 * under-counts and the bar stalls until the next reading re-anchors it, where a wall clock would
 * jump forward by however long the lid was shut. A new reading resets the count, which is what keeps
 * it from drifting.
 */
export class PlayheadClock {
    private anchor = '';
    private carried = 0;

    /** The carried time for this reading, starting over when the reading is a new one. */
    carriedFor(status: StatusReading | undefined): number {
        // The etag moves on anything the player considers a change, so a new track is a new anchor.
        // `secs` is in it as well, because a seek moves the position without moving the etag.
        const anchor = `${status?.etag ?? ''}:${status?.secs ?? ''}`;
        if (anchor !== this.anchor) {
            this.anchor = anchor;
            this.carried = 0;
        }
        return this.carried;
    }

    tick(): void {
        this.carried += TICK_MS;
    }
}
