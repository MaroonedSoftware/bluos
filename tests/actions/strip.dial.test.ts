import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysWorld } from '../../src/actions/player.keys.js';
import { SKIP_GUARD_MS, StripDial } from '../../src/actions/strip.dial.js';
import { WatcherPool } from '../../src/bluos/watcher.pool.js';
import { ArtworkCache } from '../../src/display/artwork.js';
import { THROTTLE_MS } from '../../src/display/dial.face.js';
import { FakeStripDial } from '../fixtures/fake.key.js';
import { FakePlayer } from '../fixtures/fake.player.js';

const settle = async (): Promise<void> => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 16; i++) await Promise.resolve();
};
const drawn = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(THROTTLE_MS + 10);
    await settle();
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function rig(player: FakePlayer) {
    const pool = new WatcherPool({ userAgent: 'test', fetch: player.fetch });
    const artwork = new ArtworkCache({
        userAgent: 'test',
        fetch: (async () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } })) as typeof globalThis.fetch,
    });
    const logs: string[] = [];
    const world: KeysWorld = { pool, global: () => ({}), log: sentence => logs.push(sentence) };
    return { strip: new StripDial(world, artwork, () => Date.now()), pool, logs };
}

/** A panel across all four dials, placed right to left to prove the order comes from the column. */
function four(strip: StripDial): FakeStripDial[] {
    const dials = [3, 2, 1, 0].map(column => new FakeStripDial(`d${column}`, { column, row: 0 }));
    for (const dial of dials) strip.appear(dial, { address: 'p' });
    return dials.sort((a, b) => a.coordinates.column - b.coordinates.column);
}

describe('the now-playing strip', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('spreads one player across four dials, left to right', async () => {
        const { strip, pool } = rig(
            new FakePlayer({ title1: 'Perfect', title2: 'Ed Sheeran', secs: 35, totlen: 263, image: '/Artwork?x=1' }, { name: 'Office' }),
        );
        const [cover, track, player, time] = four(strip);
        await settle();
        await drawn();

        expect(cover!.shown.cover).toMatchObject({ enabled: true });
        expect(String((cover!.shown.cover as { value?: string }).value)).toMatch(/^data:image\/jpeg;base64,/);
        expect(track!.shown).toMatchObject({ line: 'Perfect', sub: 'Ed Sheeran' });
        expect(player!.shown).toMatchObject({ line: 'Office', sub: 'Playing' });
        expect(time!.shown.line).toBe('0:35');
        pool.disposeAll();
    });

    // Every quarter watches the same player, so four dials still cost one long-poll.
    it('shares one long-poll between the four quarters', async () => {
        const player = new FakePlayer();
        const { strip, pool } = rig(player);
        four(strip);
        await settle();
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
        expect(player.holding).toBe(1);
        pool.disposeAll();
    });

    it('moves the clock between readings, because secs never wakes a long-poll', async () => {
        const { strip, pool } = rig(new FakePlayer({ secs: 10, totlen: 200, state: 'play' }));
        const [, , , time] = four(strip);
        await settle();
        await drawn();
        expect(time!.shown.line).toBe('0:10');

        await vi.advanceTimersByTimeAsync(3_000);
        await drawn();
        expect(time!.shown.line).toBe('0:13');
        pool.disposeAll();
    });

    // A page switch gives every dial a new clock, and the watcher, still lingering, hands it the last
    // reading, which an unchanged long-poll never replaced. Starting that clock at zero drew the bar
    // where the track was at the last change and kept it that far behind.
    it('keeps its place in the track across a page switch', async () => {
        const { strip, pool } = rig(new FakePlayer({ secs: 10, totlen: 200, state: 'play' }));
        four(strip);
        await settle();
        await vi.advanceTimersByTimeAsync(3_000);
        await drawn();

        for (const column of [0, 1, 2, 3]) strip.disappear(`d${column}`);
        await vi.advanceTimersByTimeAsync(1_000);
        const [, , , time] = four(strip);
        await settle();
        await drawn();
        expect(time!.shown.line).toMatch(/^0:1[34]$/);
        pool.disposeAll();
    });

    describe('turning', () => {
        it('skips forward one track, and back one', async () => {
            const player = new FakePlayer({ totlen: 200 });
            const { strip, pool } = rig(player);
            const [dial] = four(strip);
            await settle();

            await strip.rotate(dial!.id, 1);
            await vi.advanceTimersByTimeAsync(SKIP_GUARD_MS + 10);
            await strip.rotate(dial!.id, -1);
            expect(player.requests).toContain('/Skip');
            expect(player.requests).toContain('/Back');
            pool.disposeAll();
        });

        // One detent is one track, so without a guard a brushed knob could run through half an album.
        it('ignores the rest of a turn for a moment after a skip', async () => {
            const player = new FakePlayer({ totlen: 200 });
            const { strip, pool } = rig(player);
            const [dial] = four(strip);
            await settle();

            for (let i = 0; i < 6; i++) await strip.rotate(dial!.id, 1);
            expect(player.requests.filter(path => path === '/Skip')).toHaveLength(1);
            pool.disposeAll();
        });

        it('skips on a stream through the station’s own action', async () => {
            const player = new FakePlayer({
                state: 'stream',
                streamUrl: 'Slacker:x',
                totlen: undefined,
                actions: [{ name: 'skip', url: '/Action?service=Slacker&skip=9' }],
            });
            const { strip, pool } = rig(player);
            const [dial] = four(strip);
            await settle();
            await strip.rotate(dial!.id, 1);
            expect(player.requests).toContain('/Action?service=Slacker&skip=9');
            pool.disposeAll();
        });

        it('refuses on a stream that offers no skip', async () => {
            const player = new FakePlayer({ state: 'stream', streamUrl: 'TuneIn:x', totlen: undefined });
            const { strip, pool } = rig(player);
            const [dial] = four(strip);
            await settle();
            await strip.rotate(dial!.id, 1);
            expect(player.requests.some(path => path.startsWith('/Skip'))).toBe(false);
            expect(dial!.alerts).toBe(1);
            pool.disposeAll();
        });
    });

    it('plays or pauses when pressed or tapped', async () => {
        const player = new FakePlayer({ state: 'play' });
        const { strip, pool } = rig(player);
        const [dial] = four(strip);
        await settle();
        await strip.playPause(dial!.id);
        expect(player.requests).toContain('/Pause');
        pool.disposeAll();
    });

    it('says a failure once, in the title quarter', async () => {
        const { strip, pool } = rig(new FakePlayer());
        const dials = [0, 1, 2, 3].map(column => new FakeStripDial(`d${column}`, { column, row: 0 }));
        for (const dial of dials) strip.appear(dial, {});
        await drawn();
        expect(dials.map(dial => dial.shown.line)).toEqual(['', 'No player', '', '']);
        pool.disposeAll();
    });
});
