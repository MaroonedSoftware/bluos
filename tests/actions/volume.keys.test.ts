import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysWorld } from '../../src/actions/player.keys.js';
import { REPEAT_CEILING, REPEAT_DELAY_MS, REPEAT_EVERY_MS, VolumeKeys } from '../../src/actions/volume.keys.js';
import { WatcherPool } from '../../src/bluos/watcher.pool.js';
import { FakeKey } from '../fixtures/fake.key.js';
import { FakePlayer } from '../fixtures/fake.player.js';

const settle = async (): Promise<void> => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 16; i++) await Promise.resolve();
};

function rig(player: FakePlayer) {
    const pool = new WatcherPool({ userAgent: 'test', fetch: player.fetch });
    const logs: string[] = [];
    const world: KeysWorld = { pool, global: () => ({}), log: sentence => logs.push(sentence) };
    return { keys: new VolumeKeys(world), pool, logs };
}

/** Every level the player was asked to set, in order. */
const levels = (player: FakePlayer): number[] =>
    player.requests.filter(path => path.startsWith('/Volume?level=')).map(path => Number(new URL(path, 'http://p').searchParams.get('level')));

describe('the volume key', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('turns the player up by its step', async () => {
        const player = new FakePlayer({ volume: 19 });
        const { keys, pool } = rig(player);
        keys.appear(new FakeKey('k1'), { address: 'p', direction: 'up', step: 5 });
        await settle();

        await keys.down('k1');
        keys.up('k1');
        await settle();
        expect(levels(player)).toEqual([24]);
        pool.disposeAll();
    });

    it('turns it down', async () => {
        const player = new FakePlayer({ volume: 19 });
        const { keys, pool } = rig(player);
        keys.appear(new FakeKey('k1'), { address: 'p', direction: 'down', step: 4 });
        await settle();

        await keys.down('k1');
        keys.up('k1');
        await settle();
        expect(levels(player)).toEqual([15]);
        pool.disposeAll();
    });

    // Drawn before it is written, so the key answers the finger rather than the network.
    it('shows the new level before the player has confirmed it', async () => {
        const player = new FakePlayer({ volume: 19 });
        const { keys, pool } = rig(player);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p', direction: 'up', step: 5 });
        await settle();

        void keys.down('k1');
        await Promise.resolve();
        expect(key.title).toBe('24');
        keys.up('k1');
        pool.disposeAll();
    });

    it('mutes and unmutes, with 1 meaning muted', async () => {
        const player = new FakePlayer({ volume: 19 });
        const { keys, pool } = rig(player);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p', direction: 'mute' });
        await settle();

        await keys.down('k1');
        await settle();
        expect(player.requests).toContain('/Volume?mute=1');
        expect(key.title).toBe('Muted');
        pool.disposeAll();
    });

    describe('holding the key down', () => {
        it('steps once, pauses, then repeats', async () => {
            const player = new FakePlayer({ volume: 0 });
            const { keys, pool } = rig(player);
            keys.appear(new FakeKey('k1'), { address: 'p', direction: 'up', step: 1 });
            await settle();

            await keys.down('k1');
            expect(levels(player)).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(REPEAT_DELAY_MS - 50);
            await settle();
            expect(levels(player)).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(100 + REPEAT_EVERY_MS * 3);
            await settle();
            expect(levels(player).length).toBeGreaterThan(1);
            keys.up('k1');
            pool.disposeAll();
        });

        it('stops when the finger comes off', async () => {
            const player = new FakePlayer({ volume: 0 });
            const { keys, pool } = rig(player);
            keys.appear(new FakeKey('k1'), { address: 'p', direction: 'up', step: 1 });
            await settle();

            await keys.down('k1');
            await vi.advanceTimersByTimeAsync(REPEAT_DELAY_MS + REPEAT_EVERY_MS * 3);
            await settle();
            keys.up('k1');
            const taken = levels(player).length;

            await vi.advanceTimersByTimeAsync(5_000);
            await settle();
            expect(levels(player).length).toBe(taken);
            pool.disposeAll();
        });

        // The worst thing that could happen in this plugin. onKeyUp CAN be lost: a profile change,
        // a disconnect, or the app restarting with a finger down.
        it('stops at its ceiling even when the release never comes', async () => {
            const player = new FakePlayer({ volume: 0 });
            const { keys, pool, logs } = rig(player);
            keys.appear(new FakeKey('k1'), { address: 'p', direction: 'up', step: 1 });
            await settle();

            await keys.down('k1');
            // Far longer than any human hold, and the release is never sent.
            await vi.advanceTimersByTimeAsync(60_000);
            await settle();

            expect(levels(player).length).toBeLessThanOrEqual(REPEAT_CEILING);
            expect(logs.some(line => line.includes('reached its limit'))).toBe(true);
            pool.disposeAll();
        });

        it('stops when the key leaves the deck mid-hold, which never sends a release', async () => {
            const player = new FakePlayer({ volume: 0 });
            const { keys, pool } = rig(player);
            keys.appear(new FakeKey('k1'), { address: 'p', direction: 'up', step: 1 });
            await settle();

            await keys.down('k1');
            await vi.advanceTimersByTimeAsync(REPEAT_DELAY_MS + REPEAT_EVERY_MS);
            keys.disappear('k1');
            const taken = levels(player).length;

            await vi.advanceTimersByTimeAsync(5_000);
            await settle();
            expect(levels(player).length).toBe(taken);
            pool.disposeAll();
        });

        it('does not repeat a mute key, which has nothing to repeat', async () => {
            const player = new FakePlayer({ volume: 19 });
            const { keys, pool } = rig(player);
            keys.appear(new FakeKey('k1'), { address: 'p', direction: 'mute' });
            await settle();

            await keys.down('k1');
            await vi.advanceTimersByTimeAsync(5_000);
            await settle();
            expect(player.requests.filter(path => path.includes('mute='))).toHaveLength(1);
            pool.disposeAll();
        });
    });

    // A held key is the fastest way to a loud room, which is what the maximum is for.
    it('holds a held key at its maximum', async () => {
        const player = new FakePlayer({ volume: 20 });
        const { keys, pool } = rig(player);
        keys.appear(new FakeKey('k1'), { address: 'p', direction: 'up', step: 5, maxVolume: 35 });
        await settle();

        await keys.down('k1');
        await vi.advanceTimersByTimeAsync(10_000);
        await settle();
        keys.up('k1');
        expect(Math.max(...levels(player))).toBe(35);
        pool.disposeAll();
    });

    it('takes a new maximum from its settings', async () => {
        const player = new FakePlayer({ volume: 20 });
        const { keys, pool } = rig(player);
        keys.appear(new FakeKey('k1'), { address: 'p', direction: 'up', step: 5 });
        await settle();
        keys.settingsChanged('k1', { address: 'p', direction: 'up', step: 5, maxVolume: 22 });

        await keys.down('k1');
        keys.up('k1');
        await settle();
        expect(levels(player)).toEqual([22]);
        pool.disposeAll();
    });

    describe('refusing', () => {
        it('refuses a fixed output and says so on the key', async () => {
            const player = new FakePlayer({ volume: -1 });
            const { keys, pool, logs } = rig(player);
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p', direction: 'up' });
            await settle();

            expect(key.title).toBe('Fixed');
            await keys.down('k1');
            await settle();
            expect(levels(player)).toEqual([]);
            expect(key.alerts).toBe(1);
            expect(logs.at(-1)).toContain('fixed output level');
            pool.disposeAll();
        });

        it('refuses while there is no player', async () => {
            const { keys, pool } = rig(new FakePlayer());
            const key = new FakeKey('k1');
            keys.appear(key, { direction: 'up' });
            await keys.down('k1');
            expect(key.alerts).toBe(1);
            expect(key.title).toBe('No player');
            pool.disposeAll();
        });

        it('refuses on a stale reading, and does not start repeating', async () => {
            const player = new FakePlayer({ volume: 19 });
            const { keys, pool } = rig(player);
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p', direction: 'up' });
            await settle();

            player.down = 'unreachable';
            await vi.advanceTimersByTimeAsync(1_100);
            await settle();

            await keys.down('k1');
            await vi.advanceTimersByTimeAsync(5_000);
            await settle();
            expect(levels(player)).toEqual([]);
            expect(key.alerts).toBe(1);
            pool.disposeAll();
        });
    });

    it('draws a different face for each direction', async () => {
        const player = new FakePlayer({ volume: 19 });
        const { keys, pool } = rig(player);
        const up = new FakeKey('k1');
        const down = new FakeKey('k2');
        keys.appear(up, { address: 'p', direction: 'up' });
        keys.appear(down, { address: 'p', direction: 'down' });
        await settle();
        expect(up.image).not.toBe(down.image);
        pool.disposeAll();
    });

    it('leaves the level off a key that was told not to show it', async () => {
        const player = new FakePlayer({ volume: 19 });
        const { keys, pool } = rig(player);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p', direction: 'up', showLevel: false });
        await settle();
        expect(key.title).toBe('');
        pool.disposeAll();
    });
});
