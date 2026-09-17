import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VolumeWriter } from '../../src/volume/volume.writer.js';

const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('VolumeWriter', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** A player that answers when the test lets it. */
    function player() {
        const sent: number[] = [];
        let release: (() => void) | undefined;
        const send = (level: number): Promise<void> => {
            sent.push(level);
            return new Promise<void>(resolve => {
                release = () => {
                    release = undefined;
                    resolve();
                };
            });
        };
        return {
            sent,
            send,
            answer: async () => {
                release?.();
                await flush();
            },
        };
    }

    // A single click has to feel instant, which a debounce cannot do.
    it('writes the first move at once', () => {
        const { sent, send } = player();
        new VolumeWriter(send, { now: () => Date.now() }).want(24);
        expect(sent).toEqual([24]);
    });

    // The mailbox: many moves during one slow write cost one further write, carrying the LAST value.
    it('coalesces everything asked for while a write is in flight', async () => {
        const { sent, send, answer } = player();
        const writer = new VolumeWriter(send, { now: () => Date.now() });
        writer.want(20);
        writer.want(21);
        writer.want(22);
        writer.want(23);
        expect(sent).toEqual([20]);

        await answer();
        await vi.advanceTimersByTimeAsync(100);
        await flush();
        expect(sent).toEqual([20, 23]);
    });

    it('sends nothing more when nothing moved while the write was out', async () => {
        const { sent, send, answer } = player();
        const writer = new VolumeWriter(send, { now: () => Date.now() });
        writer.want(20);
        await answer();
        await vi.advanceTimersByTimeAsync(200);
        await flush();
        expect(sent).toEqual([20]);
    });

    it('keeps a floor between two writes starting', async () => {
        const { sent, send, answer } = player();
        const writer = new VolumeWriter(send, { minGapMs: 60, now: () => Date.now() });
        writer.want(20);
        await answer();
        writer.want(21);
        await flush();
        expect(sent).toEqual([20]);

        await vi.advanceTimersByTimeAsync(70);
        await flush();
        expect(sent).toEqual([20, 21]);
    });

    // The last value the user chose must always be the one that lands.
    it('lands on the value the user stopped at', async () => {
        const { sent, send, answer } = player();
        const writer = new VolumeWriter(send, { now: () => Date.now() });
        for (const level of [20, 21, 22, 23, 24, 25]) writer.want(level);
        await answer();
        await vi.advanceTimersByTimeAsync(100);
        await flush();
        await answer();
        await vi.advanceTimersByTimeAsync(100);
        await flush();
        expect(sent.at(-1)).toBe(25);
    });

    it('carries on after a write that failed', async () => {
        const sent: number[] = [];
        const writer = new VolumeWriter(level => {
            sent.push(level);
            return Promise.reject(new Error('no'));
        });
        writer.want(20);
        await flush();
        await vi.advanceTimersByTimeAsync(100);
        writer.want(21);
        await vi.advanceTimersByTimeAsync(100);
        await flush();
        expect(sent).toEqual([20, 21]);
    });

    it('drops what was waiting when a key leaves the deck', async () => {
        const { sent, send, answer } = player();
        const writer = new VolumeWriter(send, { now: () => Date.now() });
        writer.want(20);
        writer.want(30);
        writer.cancel();
        await answer();
        await vi.advanceTimersByTimeAsync(200);
        await flush();
        expect(sent).toEqual([20]);
    });
});
