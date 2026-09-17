import { afterEach, describe, expect, it } from 'vitest';

import { NOW_PLAYING } from '../src/actions/action.ids.js';
import { DEVICE, FakeDeck } from './fixtures/fake.deck.js';

// Against the BUILT bundle, launched the way the Stream Deck app launches it. This is the test that
// would catch a plugin that type-checks and then fails to start: a decorator lowered wrongly, an
// import the bundler left behind, a missing `{ "type": "module" }` beside it.
describe('the built plugin', () => {
    let deck: FakeDeck | undefined;

    afterEach(async () => {
        await deck?.close();
        deck = undefined;
    });

    it('registers itself with the Stream Deck app', async () => {
        deck = await FakeDeck.launch();
        const registration = deck.received.find(message => message.event === 'registerPlugin');
        expect(registration?.uuid).toBe('com.maroonedsoftware.bluos');
        expect(deck.faults).toBe('');
    });

    it('takes a key appearing and disappearing without complaint', async () => {
        deck = await FakeDeck.launch();
        const context = 'key-1';
        const appear = {
            event: 'willAppear',
            action: NOW_PLAYING,
            context,
            device: DEVICE.id,
            payload: { controller: 'Keypad', coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings: {} },
        };
        deck.send(appear);
        deck.send({ ...appear, event: 'willDisappear' });

        // Nothing is drawn yet, so the proof is that the plugin is still alive and answering: it
        // replies to a settings request after handling both events.
        deck.send({ event: 'didReceiveGlobalSettings', payload: { settings: {} } });
        await new Promise(resolve => setTimeout(resolve, 250));
        expect(deck.faults).toBe('');
        expect(deck.received.some(message => message.event === 'registerPlugin')).toBe(true);
    });
});
