import { beforeEach, describe, expect, it } from 'vitest';

import type { StatusReading } from '../../src/bluos/status.reading.js';
import { VolumeModel } from '../../src/volume/volume.model.js';

const status = (over: Partial<StatusReading> = {}): StatusReading => ({
    playing: true,
    fixedVolume: false,
    muted: false,
    canSeek: false,
    queued: true,
    ...over,
});

let clock = 1_000;
const now = (): number => clock;
const model = (): VolumeModel => new VolumeModel({ settleMs: 800, now });

describe('VolumeModel', () => {
    beforeEach(() => {
        clock = 1_000;
    });

    it('shows what the player reported until somebody asks for something else', () => {
        const volume = model();
        volume.reportFromPlayer(status({ volume: 19 }));
        expect(volume.level).toBe(19);
        expect(volume.pending).toBe(false);
    });

    it('shows what was asked for immediately, before any write has landed', () => {
        const volume = model();
        volume.reportFromPlayer(status({ volume: 19 }));
        expect(volume.nudge(5)).toBe(24);
        expect(volume.level).toBe(24);
        expect(volume.pending).toBe(true);
    });

    it('keeps the level inside 0 to 100', () => {
        const volume = model();
        volume.reportFromPlayer(status({ volume: 98 }));
        expect(volume.nudge(5)).toBe(100);
        volume.reportFromPlayer(status({ volume: 2 }));
        clock += 2_000;
        volume.reportFromPlayer(status({ volume: 2 }));
        expect(volume.nudge(-5)).toBe(0);
    });

    // The bug this whole class exists to prevent: a tick writes, the long-poll answers with the
    // pre-write value, and the dial jumps backwards under the user's fingers.
    describe('the rubber band', () => {
        it('ignores a reading that still has the old level', () => {
            const volume = model();
            volume.reportFromPlayer(status({ volume: 19 }));
            volume.nudge(5);
            volume.reportFromPlayer(status({ volume: 19 }));
            expect(volume.level).toBe(24);
        });

        it('still uses everything else in that same reading', () => {
            const volume = model();
            volume.reportFromPlayer(status({ volume: 19 }));
            volume.nudge(5);
            volume.reportFromPlayer(status({ volume: 19, fixedVolume: false, muted: false }));
            expect(volume.level).toBe(24);
            expect(volume.fixed).toBe(false);
        });

        it('settles the moment the player agrees, without waiting the window out', () => {
            const volume = model();
            volume.reportFromPlayer(status({ volume: 19 }));
            volume.nudge(5);
            volume.reportFromPlayer(status({ volume: 24 }));
            expect(volume.pending).toBe(false);
            expect(volume.level).toBe(24);
        });

        // Which is how the key follows the BluOS app, the amplifier's remote, or somebody else.
        it('adopts a change from elsewhere once the asking has settled', () => {
            const volume = model();
            volume.reportFromPlayer(status({ volume: 19 }));
            volume.nudge(5);
            volume.confirmWrite(24);
            clock += 1_000;
            volume.reportFromPlayer(status({ volume: 40 }));
            expect(volume.level).toBe(40);
        });

        it('does not adopt a change from elsewhere while the asking is unsettled', () => {
            const volume = model();
            volume.reportFromPlayer(status({ volume: 19 }));
            volume.nudge(5);
            volume.confirmWrite(24);
            clock += 100;
            volume.reportFromPlayer(status({ volume: 40 }));
            expect(volume.level).toBe(24);
        });

        it('holds the window open while the user keeps turning', () => {
            const volume = model();
            volume.reportFromPlayer(status({ volume: 19 }));
            for (let i = 0; i < 10; i++) {
                clock += 100;
                volume.nudge(1);
            }
            volume.confirmWrite(29);
            clock += 500;
            volume.reportFromPlayer(status({ volume: 19 }));
            expect(volume.level).toBe(29);
        });
    });

    // The rule that stops a player which rounds becoming an infinite write loop against a stereo.
    describe('a player that answers with a level of its own', () => {
        it('takes the player’s number rather than asking again', () => {
            const volume = model();
            volume.reportFromPlayer(status({ volume: 19 }));
            volume.nudge(5);
            // Asked for 24, told 23, which is what a configured dB range could do.
            volume.confirmWrite(23);
            expect(volume.level).toBe(23);
        });

        it('never produces a write of its own from a report', () => {
            const volume = model();
            volume.reportFromPlayer(status({ volume: 19 }));
            clock += 5_000;
            // However many readings arrive, nothing here returns a level to write.
            for (const level of [18, 17, 16, 42]) volume.reportFromPlayer(status({ volume: level }));
            expect(volume.pending).toBe(false);
            expect(volume.level).toBe(42);
        });
    });

    describe('mute', () => {
        it('turns on and off, following the examples rather than the wrong table', () => {
            const volume = model();
            expect(volume.toggleMute()).toBe(1);
            expect(volume.muted).toBe(true);
            expect(volume.toggleMute()).toBe(0);
            expect(volume.muted).toBe(false);
        });

        it('follows the player once the asking has settled', () => {
            const volume = model();
            clock += 5_000;
            volume.reportFromPlayer(status({ volume: 0, muted: true }));
            expect(volume.muted).toBe(true);
        });
    });

    describe('a fixed output', () => {
        it('refuses to move, because there is nothing to move', () => {
            const volume = model();
            volume.reportFromPlayer(status({ volume: -1, fixedVolume: true }));
            expect(volume.fixed).toBe(true);
            expect(volume.nudge(5)).toBeUndefined();
            expect(volume.setTo(50)).toBeUndefined();
        });
    });

    it('has nothing to move before the player has said where it is', () => {
        expect(model().nudge(5)).toBeUndefined();
    });
});
