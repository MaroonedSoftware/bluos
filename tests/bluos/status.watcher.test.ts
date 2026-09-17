import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BluOsClient } from '../../src/bluos/client.js';
import { StatusWatcher, type Reading } from '../../src/bluos/status.watcher.js';
import { FakePlayer } from '../fixtures/fake.player.js';

/** Lets whatever the watcher has queued actually run, without advancing the clock. */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 12; i++) await Promise.resolve();
};

interface Rig {
    player: FakePlayer;
    watcher: StatusWatcher;
    readings: Reading[];
}

function rig(player = new FakePlayer()): Rig {
    const watcher = new StatusWatcher(new BluOsClient('http://player:11000', { userAgent: 'test', fetch: player.fetch }));
    const readings: Reading[] = [];
    watcher.subscribe(reading => readings.push(reading));
    return { player, watcher, readings };
}

describe('StatusWatcher', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('asks without an etag first, so the first answer is immediate', async () => {
        const { player, watcher } = rig();
        watcher.acquire();
        await settle();
        expect(player.requests[0]).toBe('/Status');
        watcher.dispose();
    });

    it('sends the etag it was given back on the next read', async () => {
        const { player, watcher } = rig();
        watcher.acquire();
        await settle();
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
        const reads = player.requests.filter(path => path.startsWith('/Status'));
        expect(reads[1]).toContain(`etag=${player.etag}`);
        expect(reads[1]).toContain('timeout=60');
        watcher.dispose();
    });

    it('publishes the first reading to everyone watching', async () => {
        const { watcher, readings } = rig();
        watcher.acquire();
        await settle();
        expect(readings.at(-1)?.status?.firstLine).toBe('A track');
        expect(readings.at(-1)?.failure).toBeUndefined();
        watcher.dispose();
    });

    it('holds the long-poll open until something changes', async () => {
        const { player, watcher, readings } = rig();
        watcher.acquire();
        await settle();
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
        expect(player.holding).toBe(1);

        const before = readings.length;
        await vi.advanceTimersByTimeAsync(30_000);
        await settle();
        expect(readings.length).toBe(before);

        player.change({ title1: 'Another track' });
        await settle();
        expect(readings.at(-1)?.status?.firstLine).toBe('Another track');
        watcher.dispose();
    });

    // The rule the sibling plugin has no counterpart for, and the one that fails quietly.
    describe('an answer with an unchanged etag', () => {
        it('publishes nothing, so a key does not redraw an identical frame', async () => {
            const { player, watcher, readings } = rig();
            watcher.acquire();
            await settle();
            const settled = readings.length;

            // A read whose etag no longer matches, because the player moved on and back again.
            player.change({ title1: 'B' });
            await vi.advanceTimersByTimeAsync(1_000);
            await settle();
            expect(readings.length).toBeGreaterThan(settled);

            const after = readings.length;
            await vi.advanceTimersByTimeAsync(5_000);
            await settle();
            expect(readings.length).toBe(after);
            watcher.dispose();
        });

        it('still counts as alive, so the backoff resets and a stale key comes back', async () => {
            const { player, watcher, readings } = rig();
            watcher.acquire();
            await settle();

            player.down = 'unreachable';
            await vi.advanceTimersByTimeAsync(1_000);
            await settle();
            expect(readings.at(-1)?.stale).toBe(true);
            expect(readings.at(-1)?.failure).toBe('unreachable');

            // The player comes back with nothing about it changed. The read after a failure carries
            // no etag, so it answers at once instead of holding for a minute on the old one.
            player.down = undefined;
            await vi.advanceTimersByTimeAsync(2_000);
            await settle();
            expect(readings.at(-1)?.stale).toBe(false);
            expect(readings.at(-1)?.failure).toBeUndefined();
            watcher.dispose();
        });
    });

    describe('a failure', () => {
        it('keeps the last reading and marks it stale rather than blanking it', async () => {
            const { player, watcher, readings } = rig();
            watcher.acquire();
            await settle();

            player.down = 'unreachable';
            await vi.advanceTimersByTimeAsync(1_000);
            await settle();
            expect(readings.at(-1)?.status?.firstLine).toBe('A track');
            expect(readings.at(-1)?.stale).toBe(true);
            watcher.dispose();
        });

        it('tells a refused port apart from a player that is not there', async () => {
            const { player, watcher, readings } = rig();
            player.down = 'refused';
            watcher.acquire();
            await settle();
            expect(readings.at(-1)?.failure).toBe('refused');
            watcher.dispose();
        });

        it('tells something that is not a player apart from a player that refused', async () => {
            const { player, watcher, readings } = rig();
            player.down = 'garbage';
            watcher.acquire();
            await settle();
            expect(readings.at(-1)?.failure).toBe('notAPlayer');

            player.down = 'rejected';
            await vi.advanceTimersByTimeAsync(2_000);
            await settle();
            expect(readings.at(-1)?.failure).toBe('rejected');
            watcher.dispose();
        });

        // Retrying WITH the etag would ask a recovered player to hold for a minute before saying so.
        it('drops the etag, so the read after it answers at once rather than holding', async () => {
            const { player, watcher } = rig();
            watcher.acquire();
            await settle();

            player.down = 'unreachable';
            await vi.advanceTimersByTimeAsync(1_000);
            await settle();
            player.down = undefined;

            const before = player.requests.length;
            await vi.advanceTimersByTimeAsync(1_100);
            await settle();
            expect(player.requests[before]).toBe('/Status');
            watcher.dispose();
        });

        it('backs off, doubling, rather than knocking every second', async () => {
            const { player, watcher } = rig();
            player.down = 'unreachable';
            watcher.acquire();
            await settle();
            const after = (): number => player.requests.length;

            const first = after();
            await vi.advanceTimersByTimeAsync(400);
            await settle();
            expect(after()).toBe(first);

            await vi.advanceTimersByTimeAsync(700); // past the 1s floor
            await settle();
            expect(after()).toBe(first + 1);

            await vi.advanceTimersByTimeAsync(1_100); // 1s backoff is under the floor, so the floor wins
            await settle();
            expect(after()).toBe(first + 2);

            await vi.advanceTimersByTimeAsync(1_100); // now the backoff is 2s and exceeds the floor
            await settle();
            expect(after()).toBe(first + 2);
            watcher.dispose();
        });
    });

    // The specification makes this a MUST, and it is also what stops a missing etag becoming a
    // denial-of-service against somebody's stereo.
    it('never reads the same resource twice inside a second, even when answers are instant', async () => {
        // A player whose etag never settles, which is the shape of the bug this guards against: the
        // success path is a loop with no timer in it, so only the floor stands between a chaining
        // failure and an unthrottled request loop against somebody's stereo.
        const player = new FakePlayer();
        let nudges = 0;
        const underneath = player.fetch;
        const restless: typeof globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            player.change({ title1: `T${++nudges}` });
            return await underneath(input as string, init);
        }) as typeof globalThis.fetch;
        const watcher = new StatusWatcher(new BluOsClient('http://player:11000', { userAgent: 'test', fetch: restless }));

        watcher.acquire();
        await settle();
        await vi.advanceTimersByTimeAsync(10_000);
        await settle();
        // Ten seconds at one per second, plus the first, with a little slack for scheduling.
        expect(player.requests.filter(path => path.startsWith('/Status')).length).toBeLessThanOrEqual(12);
        watcher.dispose();
    });

    describe('acquire and release', () => {
        it('asks nothing until a key wants it', async () => {
            const { player } = rig();
            await vi.advanceTimersByTimeAsync(5_000);
            await settle();
            expect(player.requests).toEqual([]);
        });

        it('shares one long-poll between every key', async () => {
            const { player, watcher } = rig();
            watcher.acquire();
            watcher.acquire();
            watcher.acquire();
            await settle();
            await vi.advanceTimersByTimeAsync(1_000);
            await settle();
            expect(player.holding).toBe(1);
            watcher.dispose();
        });

        // Without this, every page change on the deck costs a round trip and a blank key.
        it('lingers after the last key goes, so a page flip does not tear the socket down', async () => {
            const { watcher } = rig();
            const release = watcher.acquire();
            await settle();
            release();
            await vi.advanceTimersByTimeAsync(500);
            expect(watcher.watching).toBe(true);

            watcher.acquire();
            await vi.advanceTimersByTimeAsync(3_000);
            await settle();
            expect(watcher.watching).toBe(true);
            watcher.dispose();
        });

        it('stops once the linger runs out with nothing holding it', async () => {
            const { player, watcher } = rig();
            const release = watcher.acquire();
            await settle();
            await vi.advanceTimersByTimeAsync(1_000);
            await settle();
            expect(player.holding).toBe(1);

            release();
            await vi.advanceTimersByTimeAsync(2_500);
            await settle();
            expect(watcher.watching).toBe(false);
            expect(player.holding).toBe(0);
        });
    });

    describe('refresh, as after the machine wakes', () => {
        it('aborts the read that slept through the suspend', async () => {
            const { player, watcher } = rig();
            watcher.acquire();
            await settle();
            await vi.advanceTimersByTimeAsync(1_000);
            await settle();
            expect(player.holding).toBe(1);

            watcher.refresh();
            await settle();
            expect(player.holding).toBe(0);
            watcher.dispose();
        });

        it('drops the etag, so the next read answers at once with the current state', async () => {
            const { player, watcher } = rig();
            watcher.acquire();
            await settle();
            await vi.advanceTimersByTimeAsync(1_000);
            await settle();

            const before = player.requests.length;
            watcher.refresh();
            await vi.advanceTimersByTimeAsync(1_100);
            await settle();
            expect(player.requests[before]).toBe('/Status');
            watcher.dispose();
        });
    });

    describe('/SyncStatus', () => {
        it('is read alongside the first status, for the player’s name', async () => {
            const { player, watcher, readings } = rig();
            watcher.acquire();
            await settle();
            expect(player.requests).toContain('/SyncStatus');
            expect(readings.at(-1)?.sync?.name).toBe('Office');
            watcher.dispose();
        });

        // The mechanism the specification documents for covering both with one long-poll.
        it('is not long-polled, and is re-read only when syncStat moves', async () => {
            const { player, watcher } = rig();
            watcher.acquire();
            await settle();
            const syncReads = (): number => player.requests.filter(path => path === '/SyncStatus').length;
            const first = syncReads();

            player.change({ title1: 'Another' });
            await vi.advanceTimersByTimeAsync(1_000);
            await settle();
            expect(syncReads()).toBe(first);
            watcher.dispose();
        });
    });
});
