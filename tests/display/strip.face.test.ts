import { describe, expect, it } from 'vitest';

import { barShare, clock, SLICES, stripSlice, type StripView } from '../../src/display/strip.face.js';

const playing: StripView = {
    cover: 'data:image/jpeg;base64,AAAA',
    firstLine: 'Perfect',
    secondLine: 'Ed Sheeran',
    player: 'Office',
    doing: 'Playing',
    playhead: { elapsedSeconds: 35, totalSeconds: 263, fraction: 35 / 263 },
    live: false,
};

describe('clock', () => {
    it.each([
        [0, '0:00'],
        [35, '0:35'],
        [263, '4:23'],
        [3_725, '1:02:05'],
        [-5, '0:00'],
    ])('reads %s seconds as %s', (seconds, shown) => {
        expect(clock(seconds)).toBe(shown);
    });
});

describe('barShare', () => {
    // The four bars read as one line along the whole strip.
    it('fills the quarters one after another', () => {
        expect([0, 1, 2, 3].map(slice => barShare(0.5, slice))).toEqual([100, 100, 0, 0]);
        expect([0, 1, 2, 3].map(slice => barShare(0.375, slice))).toEqual([100, 50, 0, 0]);
        expect([0, 1, 2, 3].map(slice => barShare(1, slice))).toEqual([100, 100, 100, 100]);
        expect([0, 1, 2, 3].map(slice => barShare(0, slice))).toEqual([0, 0, 0, 0]);
    });
});

describe('stripSlice', () => {
    it('puts the cover in the first quarter, and nothing else', () => {
        expect(stripSlice(0, playing)).toMatchObject({ cover: { value: playing.cover, enabled: true }, line: '', sub: '' });
    });

    it('puts what is playing in the second', () => {
        expect(stripSlice(1, playing)).toMatchObject({ cover: { enabled: false }, line: 'Perfect', sub: 'Ed Sheeran' });
    });

    it('puts the player and what it is doing in the third', () => {
        expect(stripSlice(2, playing)).toMatchObject({ line: 'Office', sub: 'Playing' });
    });

    it('puts the time in the fourth', () => {
        expect(stripSlice(3, playing)).toMatchObject({ line: '0:35', sub: 'of 4:23' });
    });

    it('says Live in the time quarter on a stream, which has no length', () => {
        const stream: StripView = { ...playing, live: true, doing: 'TuneIn' };
        delete stream.playhead;
        expect(stripSlice(3, stream)).toMatchObject({ line: 'Live', sub: 'TuneIn', bar: { enabled: false } });
    });

    it('names the player in the first quarter when there is no cover, rather than standing empty', () => {
        const bare: StripView = { ...playing };
        delete bare.cover;
        expect(stripSlice(0, bare)).toMatchObject({ cover: { enabled: false }, line: 'Office' });
    });

    // Said once, where the title would be, rather than four times across the strip.
    it('says a failure once, in the title quarter', () => {
        const failing: StripView = { failure: 'No answer', live: false };
        expect([0, 1, 2, 3].map(column => stripSlice(column, failing).line)).toEqual(['', 'No answer', '', '']);
    });

    // The four quarters are chosen by column, so the panel reads left to right however it was placed.
    it('wraps a fifth dial round to the start, on a deck with more than four', () => {
        expect(stripSlice(SLICES, playing)).toEqual(stripSlice(0, playing));
        expect(stripSlice(SLICES + 1, playing)).toEqual(stripSlice(1, playing));
    });

    it('fills each quarter’s share of one bar along the bottom', () => {
        const half: StripView = { ...playing, playhead: { elapsedSeconds: 50, totalSeconds: 100, fraction: 0.5 } };
        expect([0, 1, 2, 3].map(column => stripSlice(column, half).bar)).toEqual([
            { value: 100, enabled: true },
            { value: 100, enabled: true },
            { value: 0, enabled: true },
            { value: 0, enabled: true },
        ]);
    });
});
