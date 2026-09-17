import { describe, expect, it } from 'vitest';

import { PressWatch } from '../../src/actions/dial.arming.js';

describe('PressWatch', () => {
    it('counts a press with no turn in it', () => {
        const watch = new PressWatch();
        watch.press();
        expect(watch.release()).toBe(true);
    });

    // The bug this exists to stop: press-and-turn is the go-faster gesture, and muting on release
    // would mute the player every single time somebody used it.
    it('does not count the end of a press-and-turn as a press', () => {
        const watch = new PressWatch();
        watch.press();
        watch.rotate();
        expect(watch.release()).toBe(false);
    });

    it('says a rotation is coarse only while the knob is held', () => {
        const watch = new PressWatch();
        expect(watch.rotate()).toBe(false);
        watch.press();
        expect(watch.rotate()).toBe(true);
        watch.release();
        expect(watch.rotate()).toBe(false);
    });

    it('does not count a release that had no press before it', () => {
        expect(new PressWatch().release()).toBe(false);
    });

    it('starts each press over, so one drag does not poison the next press', () => {
        const watch = new PressWatch();
        watch.press();
        watch.rotate();
        watch.release();
        watch.press();
        expect(watch.release()).toBe(true);
    });
});
