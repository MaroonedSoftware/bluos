import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysWorld } from '../../src/actions/player.keys.js';
import { PAUSE, PLAY, TransportKeys } from '../../src/actions/transport.keys.js';
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
    return { keys: new TransportKeys(world), pool, logs };
}

describe('Play or pause', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows Pause while the player is playing, and Play while it is not', async () => {
        const player = new FakePlayer({ state: 'play' });
        const { keys, pool } = rig(player);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();
        expect(key.state).toBe(PAUSE);

        // Past the one-second floor, so the watcher reads again and hears the change.
        player.change({ state: 'pause' });
        await vi.advanceTimersByTimeAsync(1_100);
        await settle();
        expect(key.state).toBe(PLAY);
        pool.disposeAll();
    });

    // A stream is playing as much as a track is; the specification says the two states mean the same.
    it('counts a stream as playing', async () => {
        const { keys, pool } = rig(new FakePlayer({ state: 'stream' }));
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();
        expect(key.state).toBe(PAUSE);
        pool.disposeAll();
    });

    // `/Pause?toggle=1` exists and is deliberately never used: the state is known, so the key asks
    // for what it means and a double press cannot invert it.
    it('issues the verb it means rather than a toggle', async () => {
        const player = new FakePlayer({ state: 'play' });
        const { keys, pool } = rig(player);
        keys.appear(new FakeKey('k1'), { address: 'p' });
        await settle();

        await keys.press('k1');
        expect(player.requests).toContain('/Pause');
        expect(player.requests.some(path => path.includes('toggle'))).toBe(false);
        pool.disposeAll();
    });

    it('plays a player that is paused', async () => {
        const player = new FakePlayer({ state: 'pause' });
        const { keys, pool } = rig(player);
        keys.appear(new FakeKey('k1'), { address: 'p' });
        await settle();

        await keys.press('k1');
        expect(player.requests).toContain('/Play');
        pool.disposeAll();
    });

    // The command's own answer carries the new state, so the key flips at once rather than after a
    // round trip. This is why there is no follow-up read schedule.
    it('flips the key from the command’s own answer', async () => {
        const player = new FakePlayer({ state: 'play' });
        const { keys, pool } = rig(player);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();
        expect(key.state).toBe(PAUSE);

        player.change({ state: 'pause' });
        await keys.press('k1');
        expect(key.state).toBe(PLAY);
        pool.disposeAll();
    });

    it('ticks the key when the player agreed', async () => {
        const { keys, pool } = rig(new FakePlayer({ state: 'play' }));
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();

        await keys.press('k1');
        expect(key.oks).toBe(1);
        expect(key.alerts).toBe(0);
        pool.disposeAll();
    });

    describe('refusing a press', () => {
        it('refuses while there is no player', async () => {
            const { keys, pool, logs } = rig(new FakePlayer());
            const key = new FakeKey('k1');
            keys.appear(key, {});
            await keys.press('k1');
            expect(key.alerts).toBe(1);
            expect(logs.at(-1)).toContain('no bluos player');
            pool.disposeAll();
        });

        // A reading from before the player stopped answering says nothing about what a press
        // would do now, so the key declines rather than guessing.
        it('refuses on a stale reading rather than acting on it', async () => {
            const player = new FakePlayer({ state: 'play' });
            const { keys, pool } = rig(player);
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p' });
            await settle();

            player.down = 'unreachable';
            await vi.advanceTimersByTimeAsync(1_100);
            await settle();

            const asked = player.requests.length;
            await keys.press('k1');
            expect(key.alerts).toBe(1);
            expect(player.requests.length).toBe(asked);
            pool.disposeAll();
        });

        it('says the warning triangle and the reason when the player refuses', async () => {
            const player = new FakePlayer({ state: 'stop' });
            const { keys, pool, logs } = rig(player);
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p' });
            await settle();

            player.down = 'rejected';
            await keys.press('k1');
            expect(key.alerts).toBe(1);
            // The specification: /Play resumes from pause but not from stop.
            expect(logs.at(-1)).toContain('nothing to resume');
            pool.disposeAll();
        });
    });

    it('names a failure on the key, where there is room for two words', async () => {
        const player = new FakePlayer();
        player.down = 'refused';
        const { keys, pool } = rig(player);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();
        expect(key.title).toBe('Refused');
        pool.disposeAll();
    });
});
