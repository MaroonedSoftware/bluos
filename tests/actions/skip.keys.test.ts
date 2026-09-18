import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysWorld } from '../../src/actions/player.keys.js';
import { NextKeys, PreviousKeys } from '../../src/actions/skip.keys.js';
import { WatcherPool } from '../../src/bluos/watcher.pool.js';
import { FakeKey } from '../fixtures/fake.key.js';
import { FakePlayer } from '../fixtures/fake.player.js';

const settle = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 12; i++) await Promise.resolve();
};

function rig(player: FakePlayer) {
    const pool = new WatcherPool({ userAgent: 'test', fetch: player.fetch });
    const logs: string[] = [];
    const world: KeysWorld = { pool, global: () => ({}), log: sentence => logs.push(sentence) };
    return { next: new NextKeys(world), previous: new PreviousKeys(world), pool, logs };
}

/** A player playing from its queue, which is the only state in which skipping means anything. */
const queued = (): FakePlayer => new FakePlayer({ state: 'play', totlen: 240 });
/** A player on internet radio, which is what the one this was built against does all day. */
const streaming = (): FakePlayer => new FakePlayer({ state: 'stream', streamUrl: 'TuneIn:https://example.com/live.mp3', totlen: undefined });

describe('Next and Previous', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('skip forwards and backwards through a queue', async () => {
        const player = queued();
        const { next, previous, pool } = rig(player);
        next.appear(new FakeKey('k1'), { address: 'p' });
        previous.appear(new FakeKey('k2'), { address: 'p' });
        await settle();

        await next.press('k1');
        await previous.press('k2');
        expect(player.requests).toContain('/Skip');
        expect(player.requests).toContain('/Back');
        pool.disposeAll();
    });

    // The specification's rule, and the ordinary case rather than an edge one: a streamUrl means
    // "the play queue is not the source" and that "next and previous are not available".
    describe('while the player is on a stream', () => {
        it('refuses the press and asks the player nothing', async () => {
            const player = streaming();
            const { next, pool, logs } = rig(player);
            const key = new FakeKey('k1');
            next.appear(key, { address: 'p' });
            await settle();
            const asked = player.requests.length;

            await next.press('k1');
            expect(key.alerts).toBe(1);
            expect(player.requests.length).toBe(asked);
            expect(logs.at(-1)).toContain('There is no next track');
            pool.disposeAll();
        });

        it('says which way it would have gone', async () => {
            const { previous, pool, logs } = rig(streaming());
            previous.appear(new FakeKey('k1'), { address: 'p' });
            await settle();
            await previous.press('k1');
            expect(logs.at(-1)).toContain('There is no previous track');
            pool.disposeAll();
        });

        // A key cannot be greyed out, so it says on its face that it will not work rather than
        // looking ready and then refusing.
        it('says so on the key itself', async () => {
            const { next, pool } = rig(streaming());
            const key = new FakeKey('k1');
            next.appear(key, { address: 'p' });
            await settle();
            expect(key.title).toBe('Stream');
            pool.disposeAll();
        });
    });

    // The specification: "next and previous are not available (but see also actions)". An earlier
    // version dropped the brackets and refused every stream, including ones that could skip.
    describe('while the player is on a station that CAN skip', () => {
        const station = (): FakePlayer =>
            new FakePlayer({
                state: 'stream',
                streamUrl: 'Slacker:station/1',
                totlen: undefined,
                actions: [{ name: 'back' }, { name: 'skip', url: '/Action?service=Slacker&skip=4799148' }],
            });

        it('asks the station’s own skip URL', async () => {
            const player = station();
            const { next, pool } = rig(player);
            const key = new FakeKey('k1');
            next.appear(key, { address: 'p' });
            await settle();

            await next.press('k1');
            expect(player.requests).toContain('/Action?service=Slacker&skip=4799148');
            expect(player.requests.some(path => path.startsWith('/Skip'))).toBe(false);
            expect(key.alerts).toBe(0);
            pool.disposeAll();
        });

        it('looks ready rather than saying Stream', async () => {
            const { next, pool } = rig(station());
            const key = new FakeKey('k1');
            next.appear(key, { address: 'p' });
            await settle();
            expect(key.title).toBe('');
            pool.disposeAll();
        });

        // The same station offers no back, which it says with an action that has no url.
        it('still refuses the direction the station does not offer', async () => {
            const { previous, pool, logs } = rig(station());
            const key = new FakeKey('k1');
            previous.appear(key, { address: 'p' });
            await settle();
            expect(key.title).toBe('Stream');

            await previous.press('k1');
            expect(key.alerts).toBe(1);
            expect(logs.at(-1)).toContain('does not offer one');
            pool.disposeAll();
        });
    });

    it('shows nothing extra while the queue is the source', async () => {
        const { next, pool } = rig(queued());
        const key = new FakeKey('k1');
        next.appear(key, { address: 'p' });
        await settle();
        expect(key.title).toBe('');
        pool.disposeAll();
    });

    it('refuses while there is no player', async () => {
        const { next, pool } = rig(queued());
        const key = new FakeKey('k1');
        next.appear(key, {});
        await next.press('k1');
        expect(key.alerts).toBe(1);
        expect(key.title).toBe('No player');
        pool.disposeAll();
    });

    it('refuses on a stale reading rather than acting on it', async () => {
        const player = queued();
        const { next, pool } = rig(player);
        const key = new FakeKey('k1');
        next.appear(key, { address: 'p' });
        await settle();

        player.down = 'unreachable';
        await vi.advanceTimersByTimeAsync(1_100);
        await settle();
        const asked = player.requests.length;

        await next.press('k1');
        expect(key.alerts).toBe(1);
        expect(player.requests.length).toBe(asked);
        pool.disposeAll();
    });
});
