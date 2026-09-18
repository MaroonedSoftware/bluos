import { describe, expect, it } from 'vitest';

import { readInputs } from '../../src/bluos/inputs.reading.js';
import { SPEC_INPUTS } from '../fixtures/bluos.xml.js';

describe('readInputs', () => {
    const inputs = readInputs(SPEC_INPUTS) ?? [];

    it('reads the player’s own physical inputs', () => {
        expect(inputs.filter(input => input.on === undefined).map(input => input.name)).toEqual(['Bluetooth', 'Analog Input', 'Optical Input']);
    });

    // The player sends the URL already percent-encoded. Kept that way it would be encoded again on the
    // way out and arrive as %253A, which the player would not recognise.
    it('decodes each input’s URL, so it is encoded exactly once when it is used', () => {
        expect(inputs.find(input => input.id === 'input2')?.url).toBe('Capture:bluez:bluetooth');
        expect(inputs.find(input => input.id === 'input1')?.url).toBe('Capture:hw:imxspdif,0/1/25/2?id=input1');
    });

    it('collapses a name the player wrapped across lines', () => {
        expect(inputs.find(input => input.id === 'input0')?.name).toBe('Analog Input');
    });

    // The same list carries streaming services. A key that says "Input" must not start Spotify.
    it('leaves out services, which are not inputs', () => {
        expect(inputs.some(input => input.id === 'Spotify')).toBe(false);
    });

    it('reads a hub’s inputs and says which hub they are on', () => {
        const hub = inputs.filter(input => input.on === 'Test Hub');
        expect(hub.map(input => input.name)).toEqual(['Analog Input', 'HDMI ARC']);
        expect(hub[1]?.url).toBe('Hub://192.168.1.149:11000/input4');
        expect(hub[1]?.type).toBe('arc');
    });

    it('keeps each input’s own icon', () => {
        expect(inputs.find(input => input.id === 'input1')?.image).toBe('/images/capture/ic_opticalinput.png');
    });

    it('refuses a body that is not an input list', () => {
        expect(readInputs('<status/>')).toBeUndefined();
    });

    it('drops an input whose URL cannot be decoded, rather than sending nonsense', () => {
        expect(readInputs('<radiotime><item text="Bad" inputType="analog" id="x" URL="%E0%A4%A"/></radiotime>')).toEqual([]);
    });
});
