import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NowPlayingKeys, wordsFor } from '../../src/actions/now.playing.js';
import type { KeysWorld } from '../../src/actions/player.keys.js';
import { ArtworkCache } from '../../src/display/artwork.js';
import { WatcherPool } from '../../src/bluos/watcher.pool.js';
import { FakeKey } from '../fixtures/fake.key.js';
import { FakePlayer } from '../fixtures/fake.player.js';

const settle = async (): Promise<void> => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 16; i++) await Promise.resolve();
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function rig(player: FakePlayer, art: 'ok' | 'missing' = 'ok') {
    const pool = new WatcherPool({ userAgent: 'test', fetch: player.fetch });
    const covers: string[] = [];
    const artwork = new ArtworkCache({
        userAgent: 'test',
        fetch: (async (input: RequestInfo | URL) => {
            covers.push(String(input));
            return art === 'ok' ? new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }) : new Response('no', { status: 404 });
        }) as typeof globalThis.fetch,
    });
    const world: KeysWorld = { pool, global: () => ({}), log: () => undefined };
    return { keys: new NowPlayingKeys(world, artwork), pool, covers };
}

/** The image the key was last given, decoded back into the SVG it carries. */
const svgOf = (key: FakeKey): string => decodeURIComponent((key.image ?? '').slice('data:image/svg+xml,'.length));

describe('the Now Playing key', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows the two lines the player says to use', async () => {
        const { keys, pool } = rig(new FakePlayer({ title1: 'Deadair', title2: 'Led Zeppelin' }));
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();
        expect(key.title).toBe('Deadair\nLed Zeppelin');
        pool.disposeAll();
    });

    it('fetches the cover and draws it into the key', async () => {
        const { keys, pool, covers } = rig(new FakePlayer({ image: '/Artwork?songid=1' }));
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();
        expect(covers[0]).toContain('followRedirects=1');
        expect(svgOf(key)).toContain('xlink:href="data:image/jpeg;base64,');
        pool.disposeAll();
    });

    it('draws a record when the cover could not be had', async () => {
        const { keys, pool } = rig(new FakePlayer({ image: '/Artwork?songid=1' }), 'missing');
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();
        expect(svgOf(key)).not.toContain('<image');
        expect(svgOf(key)).toContain('<circle');
        pool.disposeAll();
    });

    it('asks for a cover once per track rather than on every redraw', async () => {
        const { keys, pool, covers } = rig(new FakePlayer({ image: '/Artwork?songid=1' }));
        keys.appear(new FakeKey('k1'), { address: 'p' });
        await settle();
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        expect(covers).toHaveLength(1);
        pool.disposeAll();
    });

    // The bar is the one thing in this plugin that needs a timer, because secs is left out of the
    // player's etag and a long-poll therefore never wakes for it.
    it('moves the bar between readings', async () => {
        const { keys, pool } = rig(new FakePlayer({ secs: 0, totlen: 72, state: 'play' }));
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();
        const first = svgOf(key);

        await vi.advanceTimersByTimeAsync(4_000);
        await settle();
        expect(svgOf(key)).not.toBe(first);
        expect(svgOf(key)).toContain('height="8"');
        pool.disposeAll();
    });

    // Another key keeps the player's watcher alive, so a key arriving later is handed a reading that is
    // half a minute old. Its bar starts from where the track is now, not from that reading.
    it('draws a key that arrives late at the same place as one that was there all along', async () => {
        const { keys, pool } = rig(new FakePlayer({ secs: 0, totlen: 72, state: 'play' }));
        const early = new FakeKey('k1');
        keys.appear(early, { address: 'p' });
        await settle();
        const start = svgOf(early);

        await vi.advanceTimersByTimeAsync(30_000);
        await settle();
        const late = new FakeKey('k2');
        keys.appear(late, { address: 'p' });
        await settle();
        expect(svgOf(late)).not.toBe(start);
        pool.disposeAll();
    });

    // Which is the ordinary case: the player this was built against streams all day.
    it('draws no bar for a stream, which has no length', async () => {
        const { keys, pool } = rig(new FakePlayer({ state: 'stream', secs: 9_696, totlen: undefined, streamUrl: 'TuneIn:x' }));
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();
        await vi.advanceTimersByTimeAsync(4_000);
        await settle();
        expect(svgOf(key)).not.toContain('height="8"');
        pool.disposeAll();
    });

    it('stops redrawing once its last key has gone', async () => {
        const { keys, pool } = rig(new FakePlayer({ secs: 0, totlen: 72 }));
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p' });
        await settle();
        keys.disappear('k1');
        const drawn = key.images.length;
        await vi.advanceTimersByTimeAsync(5_000);
        await settle();
        expect(key.images.length).toBe(drawn);
        pool.disposeAll();
    });

    describe('what a key is asked to show', () => {
        it('draws everything when nothing was configured', async () => {
            const { keys, pool } = rig(new FakePlayer({ secs: 10, totlen: 200 }));
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p' });
            await settle();
            expect(key.title).not.toBe('');
            expect(svgOf(key)).toContain('height="8"');
            expect(svgOf(key)).toContain('url(#shade)');
            pool.disposeAll();
        });

        it('leaves the bar off when it is turned off', async () => {
            const { keys, pool } = rig(new FakePlayer({ secs: 10, totlen: 200 }));
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p', showProgress: false });
            await settle();
            expect(svgOf(key)).not.toContain('height="8"');
            pool.disposeAll();
        });

        it('leaves the title and its shade off when the title is turned off', async () => {
            const { keys, pool } = rig(new FakePlayer({ secs: 10, totlen: 200 }));
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p', showTitle: false });
            await settle();
            expect(key.title).toBe('');
            expect(svgOf(key)).not.toContain('url(#shade)');
            pool.disposeAll();
        });

        // Two keys can want different things, which is why these are action settings.
        it('lets two keys on one player draw differently', async () => {
            const { keys, pool } = rig(new FakePlayer({ secs: 10, totlen: 200 }));
            const plain = new FakeKey('k1');
            const full = new FakeKey('k2');
            keys.appear(plain, { address: 'p', showTitle: false, showProgress: false });
            keys.appear(full, { address: 'p' });
            await settle();
            expect(plain.title).toBe('');
            expect(full.title).not.toBe('');
            pool.disposeAll();
        });

        it('redraws the one key whose options changed', async () => {
            const { keys, pool } = rig(new FakePlayer({ secs: 10, totlen: 200 }));
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p' });
            await settle();
            keys.settingsChanged('k1', { address: 'p', showTitle: false });
            await settle();
            expect(key.title).toBe('');
            pool.disposeAll();
        });
    });

    // Turning the title off is a choice about the TRACK's name. A key that is actually disconnected
    // and silently blank would say nothing true.
    it('still names a failure on a key that shows no title', () => {
        expect(wordsFor({ stale: false, failure: 'unreachable' }, { title: false, progress: true })).toBe('No answer');
    });
});
