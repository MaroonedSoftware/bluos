import { afterEach, describe, expect, it } from 'vitest';

import { NOW_PLAYING } from '../src/actions/action.ids.js';
import { FakeDeck } from './fixtures/fake.deck.js';
import { servePlayer, type ServedPlayer } from './fixtures/serve.player.js';

// Against the BUILT bundle, launched the way the Stream Deck app launches it. This is the test that
// would catch a plugin that type-checks and then fails to start: a decorator lowered wrongly, an
// import the bundler left behind, a missing `{ "type": "module" }` beside it.
describe('the built plugin', () => {
    let deck: FakeDeck | undefined;
    let player: ServedPlayer | undefined;

    afterEach(async () => {
        await deck?.close();
        await player?.close();
        deck = undefined;
        player = undefined;
    });

    it('registers itself with the Stream Deck app', async () => {
        deck = await FakeDeck.launch();
        const registration = deck.received.find(message => message.event === 'registerPlugin');
        expect(registration?.uuid).toBe('com.maroonedsoftware.bluos');
        expect(deck.faults).toBe('');
    });

    // End to end through the BUILT bundle: a key appears pointed at a player on loopback, and the
    // plugin reads it over real HTTP and writes real words onto the key.
    it('draws what a real player is playing onto a key', async () => {
        player = await servePlayer();
        deck = await FakeDeck.launch();
        deck.appear('key-1', NOW_PLAYING, { address: player.address });

        const title = await deck.next(
            message => message.event === 'setTitle' && String((message.payload as { title?: string })?.title ?? '').includes('Deadair'),
        );
        expect((title.payload as { title: string }).title).toBe('Deadair\nLed Zeppelin - When the Levee Breaks - Remaster');
        expect(player.requests[0]).toBe('/Status');
        expect(deck.faults).toBe('');
    });

    it('says so on a key that has no player', async () => {
        deck = await FakeDeck.launch();
        deck.appear('key-1', NOW_PLAYING);
        const title = await deck.next(message => message.event === 'setTitle');
        expect((title.payload as { title: string }).title).toBe('No player');
    });

    it('takes a key appearing and disappearing without complaint', async () => {
        player = await servePlayer();
        deck = await FakeDeck.launch();
        deck.appear('key-1', NOW_PLAYING, { address: player.address });
        await deck.next(message => message.event === 'setTitle');
        deck.send({ event: 'willDisappear', action: NOW_PLAYING, context: 'key-1', payload: { controller: 'Keypad', settings: {} } });

        await new Promise(resolve => setTimeout(resolve, 250));
        expect(deck.faults).toBe('');
    });
});
