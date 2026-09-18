import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysWorld } from '../../src/actions/player.keys.js';
import { PresetKeys } from '../../src/actions/preset.keys.js';
import { WatcherPool } from '../../src/bluos/watcher.pool.js';
import { ArtworkCache } from '../../src/display/artwork.js';
import { SPEC_PRESETS } from '../fixtures/bluos.xml.js';
import { FakeKey } from '../fixtures/fake.key.js';
import { FakePlayer } from '../fixtures/fake.player.js';

const settle = async (): Promise<void> => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 16; i++) await Promise.resolve();
};

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function rig(player: FakePlayer) {
    const pool = new WatcherPool({ userAgent: 'test', fetch: player.fetch });
    const covers: string[] = [];
    const artwork = new ArtworkCache({
        userAgent: 'test',
        fetch: (async (input: RequestInfo | URL) => {
            covers.push(String(input));
            return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
        }) as typeof globalThis.fetch,
    });
    const logs: string[] = [];
    const world: KeysWorld = { pool, global: () => ({}), log: sentence => logs.push(sentence) };
    return { keys: new PresetKeys(world, artwork), pool, covers, logs };
}

/** A player with the specification's two presets on it. */
const withPresets = (): FakePlayer => {
    const player = new FakePlayer({ prid: '2' });
    player.presets = SPEC_PRESETS;
    return player;
};

const svgOf = (key: FakeKey): string => decodeURIComponent((key.image ?? '').slice('data:image/svg+xml,'.length));

describe('the preset key', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows the preset’s own name', async () => {
        const { keys, pool } = rig(withPresets());
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p', preset: 6 });
        await settle();
        expect(key.title).toBe('Serenity');
        pool.disposeAll();
    });

    // The reason to prefer this over a key that says "Preset 3": v1.7 added artwork to each preset.
    it('draws the preset’s own artwork, resolving a player path and asking it not to redirect', async () => {
        const { keys, pool, covers } = rig(withPresets());
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p', preset: 7 });
        await settle();
        expect(covers[0]).toBe('http://p:11000/Artwork?service=Tidal&playlistimage=afacfc12-2403-4caf-a5c5-a2af28d811c8&followRedirects=1');
        expect(svgOf(key)).toContain('xlink:href="data:image/jpeg;base64,');
        pool.disposeAll();
    });

    it('plays its preset when pressed', async () => {
        const player = withPresets();
        const { keys, pool } = rig(player);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p', preset: 6 });
        await settle();

        await keys.press('k1');
        expect(player.requests).toContain('/Preset?id=6');
        expect(key.oks).toBe(1);
        pool.disposeAll();
    });

    // The specification's +1 and -1, which loop round the player's presets at either end. A '+' in a
    // query is a space unless it is encoded, so it goes as %2B.
    it('steps to the next or previous preset', async () => {
        const player = withPresets();
        const { keys, pool } = rig(player);
        keys.appear(new FakeKey('k1'), { address: 'p', preset: 'next' });
        keys.appear(new FakeKey('k2'), { address: 'p', preset: 'previous' });
        await settle();

        await keys.press('k1');
        await keys.press('k2');
        expect(player.requests).toContain('/Preset?id=%2B1');
        expect(player.requests).toContain('/Preset?id=-1');
        pool.disposeAll();
    });

    it('reads the list once, however many keys show it', async () => {
        const player = withPresets();
        const { keys, pool } = rig(player);
        for (const id of ['k1', 'k2', 'k3']) keys.appear(new FakeKey(id), { address: 'p', preset: 6 });
        await settle();
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        expect(player.requests.filter(path => path === '/Presets')).toHaveLength(1);
        pool.disposeAll();
    });

    // prid in /Status changes whenever the presets do, so the long-poll every key already has is what
    // says to read them again. No timer.
    it('reads the list again when the player says its presets changed', async () => {
        const player = withPresets();
        const { keys, pool } = rig(player);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p', preset: 6 });
        await settle();

        player.presets = '<presets prid="3"><preset id="6" name="Serenity, renamed"/></presets>';
        player.change({ prid: '3' });
        await vi.advanceTimersByTimeAsync(1_100);
        await settle();
        expect(key.title).toBe('Serenity, renamed');
        pool.disposeAll();
    });

    describe('refusing', () => {
        it('says it has no preset until one is chosen, and refuses a press', async () => {
            const { keys, pool, logs } = rig(withPresets());
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p' });
            await settle();
            expect(key.title).toBe('No preset');

            await keys.press('k1');
            expect(key.alerts).toBe(1);
            expect(logs.at(-1)).toContain('has not been given a preset');
            pool.disposeAll();
        });

        // A key saved with a preset somebody since deleted in the BluOS app says so, rather than
        // firing an id the player will not recognise.
        it('refuses a preset the player no longer has', async () => {
            const player = withPresets();
            const { keys, pool, logs } = rig(player);
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p', preset: 99 });
            await settle();
            expect(key.title).toBe('No preset 99');

            await keys.press('k1');
            expect(player.requests.some(path => path.startsWith('/Preset?'))).toBe(false);
            expect(logs.at(-1)).toContain('no preset 99 any more');
            pool.disposeAll();
        });

        it('refuses while there is no player', async () => {
            const { keys, pool } = rig(withPresets());
            const key = new FakeKey('k1');
            keys.appear(key, { preset: 6 });
            await keys.press('k1');
            expect(key.alerts).toBe(1);
            expect(key.title).toBe('No player');
            pool.disposeAll();
        });
    });
});
