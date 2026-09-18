import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysWorld } from '../../src/actions/player.keys.js';
import { SLEEP_OFF, SLEEP_ON, SleepKeys } from '../../src/actions/sleep.keys.js';
import { StopKeys } from '../../src/actions/stop.keys.js';
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
    return { sleep: new SleepKeys(world), stop: new StopKeys(world), pool, logs };
}

describe('the sleep timer key', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('says Off when no timer is set', async () => {
        const { sleep, pool } = rig(new FakePlayer());
        const key = new FakeKey('k1');
        sleep.appear(key, { address: 'p' });
        await settle();
        expect(key.title).toBe('Off');
        expect(key.state).toBe(SLEEP_OFF);
        pool.disposeAll();
    });

    it('shows the minutes left on a timer that is running', async () => {
        const { sleep, pool } = rig(new FakePlayer({ sleep: 45 }));
        const key = new FakeKey('k1');
        sleep.appear(key, { address: 'p' });
        await settle();
        expect(key.title).toBe('45 min');
        expect(key.state).toBe(SLEEP_ON);
        pool.disposeAll();
    });

    // The key shows whatever the player answers, never an assumed list of steps, so a player with
    // different steps is shown correctly too. Only the first step, 15, has been measured.
    it('moves the timer on and shows what the player answered, at once', async () => {
        const player = new FakePlayer();
        const { sleep, pool } = rig(player);
        const key = new FakeKey('k1');
        sleep.appear(key, { address: 'p' });
        await settle();

        await sleep.press('k1');
        expect(player.requests).toContain('/Sleep');
        expect(key.title).toBe('15 min');
        expect(key.state).toBe(SLEEP_ON);
        pool.disposeAll();
    });

    it('goes back to Off when the player answers with no timer', async () => {
        const player = new FakePlayer({ sleep: 90 });
        const { sleep, pool } = rig(player);
        const key = new FakeKey('k1');
        sleep.appear(key, { address: 'p' });
        await settle();

        await sleep.press('k1');
        expect(key.title).toBe('Off');
        expect(key.state).toBe(SLEEP_OFF);
        pool.disposeAll();
    });

    it('refuses while there is no player', async () => {
        const { sleep, pool } = rig(new FakePlayer());
        const key = new FakeKey('k1');
        sleep.appear(key, {});
        await sleep.press('k1');
        expect(key.alerts).toBe(1);
        pool.disposeAll();
    });
});

describe('the stop key', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('stops the player', async () => {
        const player = new FakePlayer({ state: 'play' });
        const { stop, pool } = rig(player);
        const key = new FakeKey('k1');
        stop.appear(key, { address: 'p' });
        await settle();

        await stop.press('k1');
        expect(player.requests).toContain('/Stop');
        expect(key.oks).toBe(1);
        pool.disposeAll();
    });

    it('refuses on a stale reading rather than acting on it', async () => {
        const player = new FakePlayer({ state: 'play' });
        const { stop, pool } = rig(player);
        const key = new FakeKey('k1');
        stop.appear(key, { address: 'p' });
        await settle();
        player.down = 'unreachable';
        await vi.advanceTimersByTimeAsync(1_100);
        await settle();

        await stop.press('k1');
        expect(player.requests.some(path => path === '/Stop')).toBe(false);
        expect(key.alerts).toBe(1);
        pool.disposeAll();
    });
});
