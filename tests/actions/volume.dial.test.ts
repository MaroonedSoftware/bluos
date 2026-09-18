import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysWorld } from '../../src/actions/player.keys.js';
import { COARSE, DIAL_STEP, VolumeDial } from '../../src/actions/volume.dial.js';
import { WatcherPool } from '../../src/bluos/watcher.pool.js';
import { ArtworkCache } from '../../src/display/artwork.js';
import { THROTTLE_MS } from '../../src/display/dial.face.js';
import { FakeDial } from '../fixtures/fake.key.js';
import { FakePlayer } from '../fixtures/fake.player.js';

const settle = async (): Promise<void> => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 16; i++) await Promise.resolve();
};

/** Past the dial's throttle, so what was drawn has actually been sent. */
const drawn = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(THROTTLE_MS + 10);
    await settle();
};

function rig(player: FakePlayer) {
    const pool = new WatcherPool({ userAgent: 'test', fetch: player.fetch });
    const artwork = new ArtworkCache({ userAgent: 'test', fetch: (async () => new Response('no', { status: 404 })) as typeof globalThis.fetch });
    const logs: string[] = [];
    const world: KeysWorld = { pool, global: () => ({}), log: sentence => logs.push(sentence) };
    return { dial: new VolumeDial(world, artwork), pool, logs };
}

const levels = (player: FakePlayer): number[] =>
    player.requests.filter(path => path.startsWith('/Volume?level=')).map(path => Number(new URL(path, 'http://p').searchParams.get('level')));

describe('the volume dial', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('shows the player and its level on the strip', async () => {
        const player = new FakePlayer({ volume: 19, title1: 'Deadair' });
        const { dial, pool } = rig(player);
        const knob = new FakeDial('d1');
        dial.appear(knob, { address: 'p' });
        await settle();
        await drawn();
        expect(knob.shown).toMatchObject({ title: 'Deadair', value: '19', indicator: 19 });
        pool.disposeAll();
    });

    it('turns the player up by a detent', async () => {
        const player = new FakePlayer({ volume: 19 });
        const { dial, pool } = rig(player);
        dial.appear(new FakeDial('d1'), { address: 'p' });
        await settle();

        dial.rotate('d1', 1, false);
        await settle();
        expect(levels(player)).toEqual([19 + DIAL_STEP]);
        pool.disposeAll();
    });

    it('turns it down, and takes several ticks at once', async () => {
        const player = new FakePlayer({ volume: 40 });
        const { dial, pool } = rig(player);
        dial.appear(new FakeDial('d1'), { address: 'p' });
        await settle();

        dial.rotate('d1', -3, false);
        await settle();
        expect(levels(player)).toEqual([40 - 3 * DIAL_STEP]);
        pool.disposeAll();
    });

    it('moves further when the knob is pressed and turned', async () => {
        const player = new FakePlayer({ volume: 20 });
        const { dial, pool } = rig(player);
        dial.appear(new FakeDial('d1'), { address: 'p' });
        await settle();

        dial.rotate('d1', 1, true);
        await settle();
        expect(levels(player)).toEqual([20 + COARSE]);
        pool.disposeAll();
    });

    // Drawn before it is written, so the knob feels like hardware rather than like a network.
    it('draws the new level before the player has confirmed it', async () => {
        const player = new FakePlayer({ volume: 19 });
        const { dial, pool } = rig(player);
        const knob = new FakeDial('d1');
        dial.appear(knob, { address: 'p' });
        await settle();
        await drawn();

        dial.rotate('d1', 1, false);
        await drawn();
        expect(knob.shown.value).toBe(String(19 + DIAL_STEP));
        pool.disposeAll();
    });

    // A spin can fire far faster than a player can answer.
    it('coalesces a spin into far fewer writes than ticks', async () => {
        const player = new FakePlayer({ volume: 0 });
        const { dial, pool } = rig(player);
        dial.appear(new FakeDial('d1'), { address: 'p' });
        await settle();

        for (let i = 0; i < 30; i++) {
            dial.rotate('d1', 1, false);
            await Promise.resolve();
        }
        await vi.advanceTimersByTimeAsync(500);
        await settle();
        expect(levels(player).length).toBeLessThan(30);
        expect(levels(player).at(-1)).toBe(Math.min(100, 30 * DIAL_STEP));
        pool.disposeAll();
    });

    // One fast turn of a dial on an amplifier is the case the maximum exists for.
    it('stops a fast spin at its maximum', async () => {
        const player = new FakePlayer({ volume: 20 });
        const { dial, pool } = rig(player);
        dial.appear(new FakeDial('d1'), { address: 'p', maxVolume: 30 });
        await settle();

        for (let i = 0; i < 40; i++) {
            dial.rotate('d1', 3, false);
            await Promise.resolve();
        }
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
        expect(Math.max(...levels(player))).toBe(30);
        pool.disposeAll();
    });

    describe('pressing the knob', () => {
        it('mutes, and pressing again unmutes', async () => {
            const player = new FakePlayer({ volume: 19 });
            const { dial, pool } = rig(player);
            const knob = new FakeDial('d1');
            dial.appear(knob, { address: 'p' });
            await settle();

            dial.down('d1');
            await dial.up('d1');
            await settle();
            expect(player.requests).toContain('/Volume?mute=1');

            dial.down('d1');
            await dial.up('d1');
            await settle();
            expect(player.requests).toContain('/Volume?mute=0');
            pool.disposeAll();
        });

        // The whole reason PressWatch exists: press-and-turn is the go-faster gesture, and muting on
        // release would mute the player every single time somebody used it.
        it('does not mute at the end of a press-and-turn', async () => {
            const player = new FakePlayer({ volume: 19 });
            const { dial, pool } = rig(player);
            dial.appear(new FakeDial('d1'), { address: 'p' });
            await settle();

            dial.down('d1');
            dial.rotate('d1', 2, true);
            await dial.up('d1');
            await settle();
            expect(player.requests.some(path => path.includes('mute='))).toBe(false);
            expect(levels(player)).toHaveLength(1);
            pool.disposeAll();
        });
    });

    describe('set to play and pause on a press', () => {
        it('plays or pauses when pressed, and mutes on a tap instead', async () => {
            const player = new FakePlayer({ volume: 19, state: 'play' });
            const { dial, pool } = rig(player);
            dial.appear(new FakeDial('d1'), { address: 'p', press: 'playPause' });
            await settle();

            dial.down('d1');
            await dial.up('d1');
            await settle();
            expect(player.requests).toContain('/Pause');
            expect(player.requests.some(path => path.includes('mute='))).toBe(false);

            await dial.tap('d1');
            await settle();
            expect(player.requests).toContain('/Volume?mute=1');
            pool.disposeAll();
        });

        // A label saying "Mute" on a knob that pauses would be worse than no label at all.
        it('tells the Stream Deck app what the gestures do now', async () => {
            const { dial, pool } = rig(new FakePlayer({ volume: 19 }));
            const knob = new FakeDial('d1');
            dial.appear(knob, { address: 'p', press: 'playPause' });
            expect(knob.triggers).toEqual({ rotate: 'Volume', push: 'Play or pause', touch: 'Mute' });

            dial.settingsChanged('d1', { address: 'p', press: 'mute' });
            expect(knob.triggers).toBeUndefined();
            pool.disposeAll();
        });
    });

    it('plays or pauses when the strip is tapped, since mute is already on the knob', async () => {
        const player = new FakePlayer({ volume: 19, state: 'play' });
        const { dial, pool } = rig(player);
        dial.appear(new FakeDial('d1'), { address: 'p' });
        await settle();

        await dial.tap('d1');
        await settle();
        expect(player.requests).toContain('/Pause');
        pool.disposeAll();
    });

    describe('a player that cannot be turned', () => {
        it('says Fixed and refuses to move', async () => {
            const player = new FakePlayer({ volume: -1 });
            const { dial, pool } = rig(player);
            const knob = new FakeDial('d1');
            dial.appear(knob, { address: 'p' });
            await settle();
            await drawn();

            expect(knob.shown.value).toBe('Fixed');
            dial.rotate('d1', 1, false);
            await settle();
            expect(levels(player)).toEqual([]);
            expect(knob.alerts).toBeGreaterThan(0);
            pool.disposeAll();
        });

        it('says so when there is no player at all', async () => {
            const { dial, pool } = rig(new FakePlayer());
            const knob = new FakeDial('d1');
            dial.appear(knob, {});
            await drawn();
            expect(knob.shown.title).toBe('No player');
            expect(knob.shown.value).toBe('—');
            pool.disposeAll();
        });
    });

    it('follows the player when somebody turns it elsewhere', async () => {
        const player = new FakePlayer({ volume: 19 });
        const { dial, pool } = rig(player);
        const knob = new FakeDial('d1');
        dial.appear(knob, { address: 'p' });
        await settle();
        await drawn();

        player.change({ volume: 55 });
        await vi.advanceTimersByTimeAsync(1_200);
        await drawn();
        expect(knob.shown.value).toBe('55');
        pool.disposeAll();
    });
});
