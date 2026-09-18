import { afterEach, describe, expect, it } from 'vitest';

import { NEXT, NOW_PLAYING, STRIP, TRANSPORT } from '../src/actions/action.ids.js';
import { PAUSE } from '../src/actions/transport.keys.js';
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

    // A press through the whole stack: the app's event, the bundle, a real socket, and a player
    // that answers with the state the command produced.
    it('pauses a real player from a key press', async () => {
        player = await servePlayer();
        deck = await FakeDeck.launch();
        deck.appear('key-1', TRANSPORT, { address: player.address });
        // PAUSE, which the key can only be showing once it has heard that the player is playing.
        // Waiting for any setState at all would match the frame it draws the instant it appears,
        // before it has asked anything, and the press would land on an empty reading.
        await deck.next(message => message.event === 'setState' && (message.payload as { state?: number })?.state === PAUSE);

        deck.send({
            event: 'keyDown',
            action: TRANSPORT,
            context: 'key-1',
            payload: { settings: { address: player.address }, isInMultiAction: false },
        });
        expect(await player.asked('/Pause')).toBe('/Pause');
        expect(deck.faults).toBe('');
    });

    // The captured player is on a stream, where the specification says next and previous do not
    // exist. The key has to refuse rather than fire into nothing.
    it('refuses Next on a stream, and asks the player nothing', async () => {
        player = await servePlayer();
        deck = await FakeDeck.launch();
        deck.appear('key-1', NEXT, { address: player.address });
        await deck.next(message => message.event === 'setTitle' && (message.payload as { title?: string })?.title === 'Stream');

        const mark = deck.mark;
        deck.send({ event: 'keyDown', action: NEXT, context: 'key-1', payload: { settings: { address: player.address }, isInMultiAction: false } });
        await deck.next(message => message.event === 'showAlert', mark);
        expect(player.requests.some(path => path.startsWith('/Skip'))).toBe(false);
        expect(deck.faults).toBe('');
    });

    // A key that appears while the plugin is handling a change to the default player must keep its
    // own player. The handler used to gather every key's settings behind an await and then re-point
    // whichever keys existed afterwards, so a key arriving in between was re-pointed with no settings
    // at all and sat on "No player" until somebody touched it. On a real deck that window is startup.
    it('does not lose a key that appears while the default player is changing', async () => {
        player = await servePlayer();
        deck = await FakeDeck.launch();
        const nowPlaying = (m: { event: string; payload?: unknown }): boolean =>
            m.event === 'setTitle' && String((m.payload as { title?: string })?.title ?? '').includes('Deadair');

        deck.appear('key-a', NOW_PLAYING, { address: player.address });
        await deck.next(nowPlaying);

        // The default changes to somewhere ELSE, and a second key appears before the plugin has
        // finished with that. It has to be somewhere else: a key that lost its own settings falls
        // back to the default, so a default on the same player would hide the bug entirely. With
        // two players that is worse than "No player", because the key silently follows the wrong one.
        deck.panelWritesGlobal({ defaultAddress: '127.0.0.1:1' });
        const mark = deck.mark;
        deck.appear('key-b', NOW_PLAYING, { address: player.address });

        const drawn = await deck.next(m => m.context === 'key-b' && nowPlaying(m), mark);
        expect(drawn.context).toBe('key-b');
        await new Promise(resolve => setTimeout(resolve, 300));
        const lastForB = deck.received.filter(m => m.context === 'key-b' && m.event === 'setTitle').at(-1);
        expect((lastForB?.payload as { title?: string })?.title).toContain('Deadair');
    });

    // A dial goes through different plumbing in the SDK from a key: setFeedback into a layout rather
    // than setTitle and setImage. This is the panel's quarter for column 1, the track.
    it('draws a real player onto a dial of the now-playing strip', async () => {
        player = await servePlayer();
        deck = await FakeDeck.launch();
        deck.send({
            event: 'willAppear',
            action: STRIP,
            context: 'dial-1',
            device: 'FAKE-DEVICE-0001',
            payload: { controller: 'Encoder', coordinates: { column: 1, row: 0 }, isInMultiAction: false, settings: { address: player.address } },
        });

        const feedback = await deck.next(m => m.event === 'setFeedback' && (m.payload as { line?: string })?.line === 'Deadair');
        expect(feedback.payload).toMatchObject({ line: 'Deadair', sub: 'Led Zeppelin - When the Levee Breaks - Remaster' });
        expect(deck.faults).toBe('');
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
