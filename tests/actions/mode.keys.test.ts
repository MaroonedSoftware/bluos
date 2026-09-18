import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOVE_AVAILABLE, LOVE_UNAVAILABLE, LoveKeys } from '../../src/actions/love.keys.js';
import { REPEAT_OFF, REPEAT_QUEUE, REPEAT_TRACK, RepeatKeys, SHUFFLE_OFF, SHUFFLE_ON, ShuffleKeys } from '../../src/actions/mode.keys.js';
import type { KeysWorld } from '../../src/actions/player.keys.js';
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
    return { shuffle: new ShuffleKeys(world), repeat: new RepeatKeys(world), love: new LoveKeys(world), pool, logs };
}

const onStream = { state: 'stream', streamUrl: 'TuneIn:x', totlen: undefined } as const;

describe('shuffle', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows whether the queue is shuffled', async () => {
        const { shuffle, pool } = rig(new FakePlayer({ shuffle: 1 }));
        const key = new FakeKey('k1');
        shuffle.appear(key, { address: 'p' });
        await settle();
        expect(key.state).toBe(SHUFFLE_ON);
        pool.disposeAll();
    });

    // The state it means, not a toggle: a double press cannot land somewhere unintended.
    it('asks for the opposite of what the player last reported', async () => {
        const player = new FakePlayer({ shuffle: 0 });
        const { shuffle, pool } = rig(player);
        shuffle.appear(new FakeKey('k1'), { address: 'p' });
        await settle();
        await shuffle.press('k1');
        expect(player.requests).toContain('/Shuffle?state=1');
        pool.disposeAll();
    });

    // The player answers /Shuffle with the queue and its new state, so the key flips at once.
    it('flips from the player’s own answer', async () => {
        const player = new FakePlayer({ shuffle: 0 });
        const answering: typeof globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
            String(input).includes('/Shuffle?')
                ? new Response('<playlist name="Calm Piano" modified="0" length="160" shuffle="1" id="1051"/>')
                : await player.fetch(String(input), init)) as typeof globalThis.fetch;
        const pool = new WatcherPool({ userAgent: 'test', fetch: answering });
        const keys = new ShuffleKeys({ pool, global: () => ({}), log: () => undefined });
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();
        expect(key.state).toBe(SHUFFLE_OFF);

        await keys.press('k1');
        expect(key.state).toBe(SHUFFLE_ON);
        pool.disposeAll();
    });

    // The specification: on a stream, shuffle and repeat "should be removed from any UI".
    it('says Stream and refuses on a stream, asking the player nothing', async () => {
        const player = new FakePlayer(onStream);
        const { shuffle, pool, logs } = rig(player);
        const key = new FakeKey('k1');
        shuffle.appear(key, { address: 'p' });
        await settle();
        expect(key.title).toBe('Stream');

        await shuffle.press('k1');
        expect(player.requests.some(path => path.startsWith('/Shuffle'))).toBe(false);
        expect(key.alerts).toBe(1);
        expect(logs.at(-1)).toContain('does nothing on a stream');
        pool.disposeAll();
    });
});

describe('repeat', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // The player's own numbering, which is not the order anybody would guess.
    it('shows the state in the player’s own numbering: 0 the queue, 1 a track, 2 off', async () => {
        for (const [reported, shown] of [
            [0, REPEAT_QUEUE],
            [1, REPEAT_TRACK],
            [2, REPEAT_OFF],
        ] as const) {
            const { repeat, pool } = rig(new FakePlayer({ repeat: reported }));
            const key = new FakeKey('k1');
            repeat.appear(key, { address: 'p' });
            await settle();
            expect(key.state, `repeat=${reported}`).toBe(shown);
            pool.disposeAll();
        }
    });

    it('steps from off, to the whole queue, to one track, and back to off', async () => {
        for (const [from, to] of [
            [2, 0],
            [0, 1],
            [1, 2],
        ] as const) {
            const player = new FakePlayer({ repeat: from });
            const { repeat, pool } = rig(player);
            repeat.appear(new FakeKey('k1'), { address: 'p' });
            await settle();
            await repeat.press('k1');
            expect(player.requests, `from ${from}`).toContain(`/Repeat?state=${to}`);
            pool.disposeAll();
        }
    });

    it('refuses on a stream', async () => {
        const player = new FakePlayer(onStream);
        const { repeat, pool } = rig(player);
        const key = new FakeKey('k1');
        repeat.appear(key, { address: 'p' });
        await settle();
        await repeat.press('k1');
        expect(player.requests.some(path => path.startsWith('/Repeat'))).toBe(false);
        expect(key.alerts).toBe(1);
        pool.disposeAll();
    });
});

describe('love', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const lovable = (): FakePlayer =>
        new FakePlayer({
            ...onStream,
            actions: [
                { name: 'skip', url: '/Action?service=Slacker&skip=1' },
                { name: 'love', url: '/Action?service=Slacker&love=4799148' },
            ],
        });

    it('loves the track through the station’s own URL', async () => {
        const player = lovable();
        const { love, pool } = rig(player);
        const key = new FakeKey('k1');
        love.appear(key, { address: 'p' });
        await settle();
        expect(key.state).toBe(LOVE_AVAILABLE);

        await love.press('k1');
        expect(player.requests).toContain('/Action?service=Slacker&love=4799148');
        expect(key.oks).toBe(1);
        pool.disposeAll();
    });

    // Most sources offer nothing of the kind. The heart says so before it is pressed.
    it('goes faint where the station offers no love, and refuses', async () => {
        const { love, pool, logs } = rig(new FakePlayer(onStream));
        const key = new FakeKey('k1');
        love.appear(key, { address: 'p' });
        await settle();
        expect(key.state).toBe(LOVE_UNAVAILABLE);

        await love.press('k1');
        expect(key.alerts).toBe(1);
        expect(logs.at(-1)).toContain('does not offer a way to love');
        pool.disposeAll();
    });
});
