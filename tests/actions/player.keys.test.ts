import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NowPlayingKeys, wordsFor } from '../../src/actions/now.playing.js';
import { ArtworkCache } from '../../src/display/artwork.js';
import type { KeysWorld } from '../../src/actions/player.keys.js';
import { WatcherPool } from '../../src/bluos/watcher.pool.js';
import type { GlobalSettings } from '../../src/player.settings.js';
import { FakeKey } from '../fixtures/fake.key.js';
import { FakePlayer } from '../fixtures/fake.player.js';

const settle = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 12; i++) await Promise.resolve();
};

/**
 * Two players on one fake fetch, told apart by the host in the URL, so a test can watch a key
 * follow its own one.
 */
function twoPlayers(): { office: FakePlayer; kitchen: FakePlayer; fetch: typeof globalThis.fetch } {
    const office = new FakePlayer({ title1: 'Deadair', title2: 'Led Zeppelin' }, { name: 'Office' });
    const kitchen = new FakePlayer({ title1: 'Radio 6', title2: 'Mary Anne Hobbs' }, { name: 'Kitchen' });
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const host = new URL(String(input)).hostname;
        return await (host === 'office' ? office : kitchen).fetch(String(input), init);
    }) as typeof globalThis.fetch;
    return { office, kitchen, fetch };
}

interface Rig {
    keys: NowPlayingKeys;
    pool: WatcherPool;
    global: GlobalSettings;
    logs: string[];
}

function rig(fetch: typeof globalThis.fetch, global: GlobalSettings = {}): Rig {
    const pool = new WatcherPool({ userAgent: 'test', fetch });
    const state = { ...global };
    const logs: string[] = [];
    const world: KeysWorld = { pool, global: () => state, log: sentence => logs.push(sentence) };
    // No artwork: these tests are about which player a key follows, and a cover would only add a
    // request. The key falls back to drawing a record, which is what it does with no cover anyway.
    const artwork = new ArtworkCache({ userAgent: 'test', fetch: (async () => new Response('', { status: 404 })) as typeof globalThis.fetch });
    return { keys: new NowPlayingKeys(world, artwork), pool, global: state, logs };
}

describe('every key has its own player', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // The whole reason this class departs from the sibling plugin's, which acquires ONE poller for
    // the whole action because one API key meant one station.
    it('lets two keys of the same action follow two different players', async () => {
        const { fetch } = twoPlayers();
        const { keys, pool } = rig(fetch);
        const one = new FakeKey('k1');
        const two = new FakeKey('k2');

        keys.appear(one, { address: 'office' });
        keys.appear(two, { address: 'kitchen' });
        await settle();

        expect(one.title).toBe('Deadair\nLed Zeppelin');
        expect(two.title).toBe('Radio 6\nMary Anne Hobbs');
        expect(pool.origins.sort()).toEqual(['http://kitchen:11000', 'http://office:11000']);
        pool.disposeAll();
    });

    it('gives two keys on one player a single long-poll between them', async () => {
        const { office, fetch } = twoPlayers();
        const { keys, pool } = rig(fetch);
        keys.appear(new FakeKey('k1'), { address: 'office' });
        keys.appear(new FakeKey('k2'), { address: 'office' });
        await settle();
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();

        expect(office.holding).toBe(1);
        expect(pool.origins).toEqual(['http://office:11000']);
        pool.disposeAll();
    });

    // Subscribing hands over the current reading at once, so a key never sits on the manifest's own
    // picture while the plugin already knows the answer.
    it('draws a second key immediately from what the first already knows', async () => {
        const { fetch } = twoPlayers();
        const { keys, pool } = rig(fetch);
        keys.appear(new FakeKey('k1'), { address: 'office' });
        await settle();

        const late = new FakeKey('k2');
        keys.appear(late, { address: 'office' });
        expect(late.title).toBe('Deadair\nLed Zeppelin');
        pool.disposeAll();
    });

    it('moves a key when its settings point it somewhere else', async () => {
        const { fetch } = twoPlayers();
        const { keys, pool } = rig(fetch);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'office' });
        await settle();
        expect(key.title).toBe('Deadair\nLed Zeppelin');

        keys.settingsChanged('k1', { address: 'kitchen' });
        await settle();
        expect(key.title).toBe('Radio 6\nMary Anne Hobbs');
        pool.disposeAll();
    });

    it('lets go of a player when its last key moves away', async () => {
        const { office, fetch } = twoPlayers();
        const { keys, pool } = rig(fetch);
        keys.appear(new FakeKey('k1'), { address: 'office' });
        await settle();
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
        expect(office.holding).toBe(1);

        keys.settingsChanged('k1', { address: 'kitchen' });
        await vi.advanceTimersByTimeAsync(2_500);
        await settle();
        expect(office.holding).toBe(0);
        pool.disposeAll();
    });

    it('says nothing to a key whose settings did not actually move it', async () => {
        const { fetch } = twoPlayers();
        const { keys, pool } = rig(fetch);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'office' });
        await settle();
        const drawn = key.titles.length;

        keys.settingsChanged('k1', { address: 'office' });
        await settle();
        expect(key.titles.length).toBe(drawn);
        pool.disposeAll();
    });

    it('stops listening when a key goes', async () => {
        const { office, fetch } = twoPlayers();
        const { keys, pool } = rig(fetch);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'office' });
        await settle();
        const drawn = key.titles.length;

        keys.disappear('k1');
        office.change({ title1: 'Something else' });
        await settle();
        expect(key.titles.length).toBe(drawn);
        pool.disposeAll();
    });
});

describe('a key with no player of its own', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('says so rather than showing nothing', () => {
        const { fetch } = twoPlayers();
        const { keys, pool } = rig(fetch);
        const key = new FakeKey('k1');
        keys.appear(key, {});
        expect(key.title).toBe('No player');
        pool.disposeAll();
    });

    // Writing the default in, rather than falling back quietly, is what makes a key's settings
    // describe the key truthfully and an exported profile carry the player it was using.
    it('adopts the default by writing it into itself', async () => {
        const { fetch } = twoPlayers();
        const { keys, pool } = rig(fetch, { defaultAddress: 'office' });
        const key = new FakeKey('k1');
        keys.appear(key, {});
        await settle();

        expect(key.settings).toEqual({ address: 'office' });
        expect(key.title).toBe('Deadair\nLed Zeppelin');
        pool.disposeAll();
    });

    it('does not overwrite a key that already has one', async () => {
        const { fetch } = twoPlayers();
        const { keys, pool } = rig(fetch, { defaultAddress: 'kitchen' });
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'office' });
        await settle();

        expect(key.settings).toBeUndefined();
        expect(key.title).toBe('Deadair\nLed Zeppelin');
        pool.disposeAll();
    });
});

describe('the words a Now Playing key shows', () => {
    it('stacks the two lines the player says to use', () => {
        expect(
            wordsFor({
                stale: false,
                status: {
                    playing: true,
                    firstLine: 'Deadair',
                    secondLine: 'Led Zeppelin',
                    fixedVolume: false,
                    muted: false,
                    canSeek: false,
                    queued: false,
                },
            }),
        ).toBe('Deadair\nLed Zeppelin');
    });

    it('names a failure rather than drawing a blank', () => {
        expect(wordsFor({ stale: false, failure: 'unconfigured' })).toBe('No player');
        expect(wordsFor({ stale: true, failure: 'unreachable' })).toBe('No answer');
    });

    it('falls back to the state when the player sent no lines at all', () => {
        expect(
            wordsFor({ stale: false, status: { playing: false, state: 'stop', fixedVolume: false, muted: false, canSeek: false, queued: true } }),
        ).toBe('stop');
    });
});
