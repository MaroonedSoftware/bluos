import { describe, expect, it } from 'vitest';

import type { StatusReading } from '../../src/bluos/status.reading.js';
import { ageOf, PlayheadClock, projectPlayhead, TICK_MS } from '../../src/display/playhead.js';

const status = (over: Partial<StatusReading> = {}): StatusReading => ({
    playing: true,
    fixedVolume: false,
    muted: false,
    canSeek: false,
    actions: {},
    queued: true,
    ...over,
});

describe('projectPlayhead', () => {
    it('carries the position forward between readings', () => {
        const track = status({ secs: 30, totlen: 200 });
        expect(projectPlayhead(track, 0)?.elapsedSeconds).toBe(30);
        expect(projectPlayhead(track, 4_000)?.elapsedSeconds).toBe(34);
    });

    // The specification puts this on the client: secs is not in the etag, so a long-poll that only
    // answers on a change would leave the bar frozen for the length of a track.
    it('is why the bar moves at all, since a long-poll does not wake for secs', () => {
        expect(projectPlayhead(status({ secs: 0, totlen: 100 }), 10_000)?.fraction).toBe(0.1);
    });

    it('does not carry a paused track forward', () => {
        expect(projectPlayhead(status({ secs: 30, totlen: 200, playing: false }), 8_000)?.elapsedSeconds).toBe(30);
    });

    it('never runs past the end', () => {
        const done = projectPlayhead(status({ secs: 199, totlen: 200 }), 60_000);
        expect(done?.elapsedSeconds).toBe(200);
        expect(done?.fraction).toBe(1);
    });

    // A stream reports secs without totlen. Drawing a bar from it would be a confident lie about a
    // thing that has no end, and it is the ordinary case rather than an edge one.
    it('refuses to guess without a total length, which is what a stream gives', () => {
        expect(projectPlayhead(status({ secs: 9_696 }), 0)).toBeUndefined();
        expect(projectPlayhead(status({ secs: 10, totlen: 0 }), 0)).toBeUndefined();
        expect(projectPlayhead(status({ totlen: 200 }), 0)).toBeUndefined();
        expect(projectPlayhead(undefined, 0)).toBeUndefined();
    });
});

describe('PlayheadClock', () => {
    it('counts ticks rather than reading a clock', () => {
        const clock = new PlayheadClock();
        const track = status({ etag: 'a', secs: 10, totlen: 200 });
        expect(clock.carriedFor(track)).toBe(0);
        clock.tick();
        clock.tick();
        expect(clock.carriedFor(track)).toBe(TICK_MS * 2);
    });

    it('starts over on a new reading, which is what keeps it from drifting', () => {
        const clock = new PlayheadClock();
        clock.carriedFor(status({ etag: 'a', secs: 10 }));
        clock.tick();
        clock.tick();
        expect(clock.carriedFor(status({ etag: 'b', secs: 0 }))).toBe(0);
    });

    // A seek moves the position without necessarily moving the etag, so secs is in the anchor too.
    it('starts over when the position jumps within the same track', () => {
        const clock = new PlayheadClock();
        clock.carriedFor(status({ etag: 'a', secs: 10 }));
        clock.tick();
        expect(clock.carriedFor(status({ etag: 'a', secs: 90 }))).toBe(0);
    });

    // A control coming back onto a page gets a new clock and may be handed a reading minutes old.
    it('starts a reading it has not seen at that reading\'s age, in whole ticks', () => {
        const clock = new PlayheadClock();
        expect(clock.carriedFor(status({ etag: 'a', secs: 10 }), TICK_MS * 7 + 100)).toBe(TICK_MS * 7);
    });

    it('reads the age only at the anchor, so ticks carry it from there', () => {
        const clock = new PlayheadClock();
        const track = status({ etag: 'a', secs: 10 });
        clock.carriedFor(track, 3_000);
        clock.tick();
        expect(clock.carriedFor(track, 90_000)).toBe(3_000 + TICK_MS);
    });

    it('never starts below zero', () => {
        expect(new PlayheadClock().carriedFor(status({ etag: 'a' }), -2_000)).toBe(0);
    });
});

describe('ageOf', () => {
    it('is how long ago the reading was taken', () => {
        expect(ageOf({ readAt: 1_000 }, 4_500)).toBe(3_500);
    });

    it('is nothing for a reading that does not say when it was taken', () => {
        expect(ageOf({}, 4_500)).toBe(0);
    });
});
