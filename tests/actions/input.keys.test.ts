import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InputKeys } from '../../src/actions/input.keys.js';
import type { KeysWorld } from '../../src/actions/player.keys.js';
import { WatcherPool } from '../../src/bluos/watcher.pool.js';
import { ArtworkCache } from '../../src/display/artwork.js';
import { SPEC_INPUTS } from '../fixtures/bluos.xml.js';
import { FakeKey } from '../fixtures/fake.key.js';
import { FakePlayer } from '../fixtures/fake.player.js';

const settle = async (): Promise<void> => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 16; i++) await Promise.resolve();
};

function rig(player: FakePlayer) {
    const pool = new WatcherPool({ userAgent: 'test', fetch: player.fetch });
    const artwork = new ArtworkCache({
        userAgent: 'test',
        fetch: (async () =>
            new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
                headers: { 'content-type': 'image/png' },
            })) as typeof globalThis.fetch,
    });
    const logs: string[] = [];
    const world: KeysWorld = { pool, global: () => ({}), log: sentence => logs.push(sentence) };
    return { keys: new InputKeys(world, artwork), pool, logs };
}

const withInputs = (state: ConstructorParameters<typeof FakePlayer>[0] = {}): FakePlayer => {
    const player = new FakePlayer(state);
    player.inputs = SPEC_INPUTS;
    return player;
};

const svgOf = (key: FakeKey): string => decodeURIComponent((key.image ?? '').slice('data:image/svg+xml,'.length));

describe('the input key', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows the input’s own name', async () => {
        const { keys, pool } = rig(withInputs());
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p', input: 'input1' });
        await settle();
        expect(key.title).toBe('Optical Input');
        pool.disposeAll();
    });

    // Encoded exactly once. The player sends the URL already encoded; decoded on reading, it is encoded
    // once here. Twice would arrive as %253A and the player would not know what it meant.
    it('switches to its input, sending the URL encoded exactly once', async () => {
        const player = withInputs();
        const { keys, pool } = rig(player);
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p', input: 'input2' });
        await settle();

        await keys.press('k1');
        const play = player.requests.find(path => path.startsWith('/Play?'));
        expect(play).toBe('/Play?url=Capture%3Abluez%3Abluetooth');
        expect(play).not.toContain('%25');
        expect(key.oks).toBe(1);
        pool.disposeAll();
    });

    // A row of input keys reads like the selector on the front of an amplifier.
    it('outlines itself while its input is the one playing', async () => {
        const player = withInputs({ state: 'stream', inputId: 'input1' });
        const { keys, pool } = rig(player);
        const optical = new FakeKey('k1');
        const analog = new FakeKey('k2');
        keys.appear(optical, { address: 'p', input: 'input1' });
        keys.appear(analog, { address: 'p', input: 'input0' });
        await settle();
        expect(svgOf(optical)).toContain('stroke="#2e7bd6"');
        expect(svgOf(analog)).not.toContain('stroke="#2e7bd6"');
        pool.disposeAll();
    });

    it('draws the player’s own icon for the input', async () => {
        const { keys, pool } = rig(withInputs());
        const key = new FakeKey('k1');
        keys.appear(key, { address: 'p', input: 'input1' });
        await settle();
        expect(svgOf(key)).toContain('xlink:href="data:image/png;base64,');
        pool.disposeAll();
    });

    it('reads the list once, however many keys show it', async () => {
        const player = withInputs();
        const { keys, pool } = rig(player);
        for (const id of ['k1', 'k2', 'k3']) keys.appear(new FakeKey(id), { address: 'p', input: 'input1' });
        await settle();
        await vi.advanceTimersByTimeAsync(3_000);
        await settle();
        expect(player.requests.filter(path => path.startsWith('/RadioBrowse'))).toHaveLength(1);
        pool.disposeAll();
    });

    describe('refusing', () => {
        // The list may simply be older than the input, so it is read once more before giving up.
        it('reads the list again for an input it does not know, then refuses', async () => {
            const player = withInputs();
            const { keys, pool, logs } = rig(player);
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p', input: 'input9' });
            await settle();

            await keys.press('k1');
            expect(player.requests.filter(path => path.startsWith('/RadioBrowse'))).toHaveLength(2);
            expect(player.requests.some(path => path.startsWith('/Play?'))).toBe(false);
            expect(key.alerts).toBe(1);
            expect(logs.at(-1)).toContain('has no input "input9"');
            pool.disposeAll();
        });

        it('says it has no input until one is chosen', async () => {
            const { keys, pool } = rig(withInputs());
            const key = new FakeKey('k1');
            keys.appear(key, { address: 'p' });
            await settle();
            expect(key.title).toBe('No input');
            await keys.press('k1');
            expect(key.alerts).toBe(1);
            pool.disposeAll();
        });
    });
});
