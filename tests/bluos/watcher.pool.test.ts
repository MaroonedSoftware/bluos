import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WatcherPool } from '../../src/bluos/watcher.pool.js';
import { FakePlayer } from '../fixtures/fake.player.js';

const settle = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 12; i++) await Promise.resolve();
};

describe('WatcherPool', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('gives every key on one player the same watcher', () => {
        const pool = new WatcherPool({ userAgent: 'test', fetch: new FakePlayer().fetch });
        expect(pool.for('http://a:11000')).toBe(pool.for('http://a:11000'));
        pool.disposeAll();
    });

    // The whole reason the pool exists: four dials on a Stream Deck + are four rooms.
    it('gives two players their own', () => {
        const pool = new WatcherPool({ userAgent: 'test', fetch: new FakePlayer().fetch });
        expect(pool.for('http://a:11000')).not.toBe(pool.for('http://b:11000'));
        expect(pool.origins).toEqual(['http://a:11000', 'http://b:11000']);
        pool.disposeAll();
    });

    it('watches only the players a key is actually holding', async () => {
        const player = new FakePlayer();
        const pool = new WatcherPool({ userAgent: 'test', fetch: player.fetch });
        pool.for('http://a:11000');
        pool.for('http://b:11000').acquire();
        await settle();
        expect(pool.for('http://a:11000').watching).toBe(false);
        expect(pool.for('http://b:11000').watching).toBe(true);
        pool.disposeAll();
    });

    it('forgets a player nothing is watching, once its linger has run out', async () => {
        const player = new FakePlayer();
        const pool = new WatcherPool({ userAgent: 'test', fetch: player.fetch });
        const release = pool.for('http://a:11000').acquire();
        pool.for('http://b:11000').acquire();
        await settle();

        release();
        await vi.advanceTimersByTimeAsync(2_500);
        await settle();
        pool.tidy();
        expect(pool.origins).toEqual(['http://b:11000']);
        pool.disposeAll();
    });

    // A key that is only changing page must not have its player forgotten underneath it.
    it('leaves a player alone while it is still lingering', async () => {
        const player = new FakePlayer();
        const pool = new WatcherPool({ userAgent: 'test', fetch: player.fetch });
        const release = pool.for('http://a:11000').acquire();
        await settle();
        release();
        await vi.advanceTimersByTimeAsync(500);
        pool.tidy();
        expect(pool.origins).toEqual(['http://a:11000']);
        pool.disposeAll();
    });

    it('starts every watcher again when the machine wakes', async () => {
        const player = new FakePlayer();
        const pool = new WatcherPool({ userAgent: 'test', fetch: player.fetch });
        pool.for('http://a:11000').acquire();
        pool.for('http://b:11000').acquire();
        await settle();
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
        expect(player.holding).toBe(2);

        pool.refreshAll();
        await settle();
        expect(player.holding).toBe(0);
        pool.disposeAll();
    });
});
