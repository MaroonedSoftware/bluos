import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialPainter, THROTTLE_MS } from '../../src/display/dial.face.js';
import { FakeDial } from '../fixtures/fake.key.js';

describe('DialPainter', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const rig = () => {
        const dial = new FakeDial('d1');
        const painter = new DialPainter(() => Date.now());
        painter.add(dial);
        return { dial, painter };
    };

    it('tells a dial everything the first time', () => {
        const { dial, painter } = rig();
        painter.paint('d1', { title: 'Office', value: '19', indicator: 19 });
        expect(dial.feedback[0]).toEqual({ title: 'Office', value: '19', indicator: 19 });
    });

    // setFeedback MERGES, so a payload carrying only what moved is both correct and much smaller.
    it('sends only what moved', async () => {
        const { dial, painter } = rig();
        painter.paint('d1', { title: 'Office', value: '19', indicator: 19 });
        await vi.advanceTimersByTimeAsync(THROTTLE_MS + 10);
        painter.paint('d1', { title: 'Office', value: '21', indicator: 21 });
        expect(dial.feedback[1]).toEqual({ value: '21', indicator: 21 });
    });

    it('says nothing at all when nothing moved', async () => {
        const { dial, painter } = rig();
        painter.paint('d1', { title: 'Office', value: '19' });
        await vi.advanceTimersByTimeAsync(THROTTLE_MS + 10);
        painter.paint('d1', { title: 'Office', value: '19' });
        await vi.advanceTimersByTimeAsync(THROTTLE_MS + 10);
        expect(dial.feedback).toHaveLength(1);
    });

    // Diffing alone does not help during a spin: every field genuinely changes on every tick.
    it('throttles a spin rather than sending on every tick', async () => {
        const { dial, painter } = rig();
        for (let level = 0; level < 40; level++) {
            painter.paint('d1', { value: String(level), indicator: level });
            await vi.advanceTimersByTimeAsync(5);
        }
        await vi.advanceTimersByTimeAsync(THROTTLE_MS * 2);
        // Two hundred milliseconds of spinning, at one payload every fifty, with a little slack.
        expect(dial.feedback.length).toBeLessThanOrEqual(6);
    });

    // A dial that stopped one frame short of where the knob was left would be worse than one that lags.
    it('lands on the last thing the user did', async () => {
        const { dial, painter } = rig();
        for (let level = 0; level < 20; level++) {
            painter.paint('d1', { value: String(level), indicator: level });
            await vi.advanceTimersByTimeAsync(2);
        }
        await vi.advanceTimersByTimeAsync(THROTTLE_MS * 3);
        expect(dial.shown.value).toBe('19');
        expect(dial.shown.indicator).toBe(19);
    });

    it('forgets a dial that went, and stops anything waiting for it', async () => {
        const { dial, painter } = rig();
        painter.paint('d1', { value: '1' });
        painter.paint('d1', { value: '2' });
        painter.remove('d1');
        await vi.advanceTimersByTimeAsync(500);
        expect(dial.feedback).toHaveLength(1);
    });

    it('swallows a send that fails rather than throwing at the caller', () => {
        const dial = new FakeDial('d1');
        dial.setFeedback = () => Promise.reject(new Error('gone'));
        const painter = new DialPainter();
        painter.add(dial);
        expect(() => painter.paint('d1', { value: '1' })).not.toThrow();
    });
});
