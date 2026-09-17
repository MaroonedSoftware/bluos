import { afterEach, describe, expect, it } from 'vitest';

import { NOW_PLAYING } from '../../src/actions/action.ids.js';
import { isToInspector } from '../../src/inspector/inspector.messages.js';
import { FakeDeck, type FromPlugin } from '../fixtures/fake.deck.js';
import { servePlayer, type ServedPlayer } from '../fixtures/serve.player.js';

/**
 * The settings panel answered by the REAL bundle, over a real socket, against a real HTTP player.
 *
 * The bundle runs in its own process and cannot be handed a fake `fetch`, so the player here is an
 * actual server on loopback serving what an actual NAD M10 sent. What this proves is the whole
 * round trip end to end: the panel writes, the app delivers, the plugin checks what ARRIVED rather
 * than what the panel typed, makes a real request, and names the player back to the open panel.
 */
describe('the settings panel and the plugin', () => {
    let deck: FakeDeck | undefined;
    let player: ServedPlayer | undefined;

    afterEach(async () => {
        await deck?.close();
        await player?.close();
        deck = undefined;
        player = undefined;
    });

    const answer = async (): Promise<{ ok: boolean; text: string }> => {
        const message = await deck!.next((m: FromPlugin) => m.event === 'sendToPropertyInspector' && isToInspector(m.payload));
        return message.payload as unknown as { ok: boolean; text: string };
    };

    it('names the player it reached', async () => {
        player = await servePlayer();
        deck = await FakeDeck.launch();
        deck.appear('key-1', NOW_PLAYING, { address: player.address });
        deck.panelOpens('key-1', NOW_PLAYING);
        deck.fromPanel('key-1', NOW_PLAYING, { event: 'testConnection' });

        expect(await answer()).toEqual({ event: 'connection', ok: true, text: 'Connected to Office (NAD M10 V2).' });
        expect(player.requests[0]).toBe('/SyncStatus');
    });

    it('asks for an address before it asks the network', async () => {
        deck = await FakeDeck.launch();
        deck.appear('key-1', NOW_PLAYING);
        deck.panelOpens('key-1', NOW_PLAYING);
        deck.fromPanel('key-1', NOW_PLAYING, { event: 'testConnection' });

        const result = await answer();
        expect(result.ok).toBe(false);
        expect(result.text).toContain('Enter the player');
    });

    it('says when something answered but is not a player', async () => {
        player = await servePlayer({ syncStatus: '<html><body>Router</body></html>' });
        deck = await FakeDeck.launch();
        deck.appear('key-1', NOW_PLAYING, { address: player.address });
        deck.panelOpens('key-1', NOW_PLAYING);
        deck.fromPanel('key-1', NOW_PLAYING, { event: 'testConnection' });

        const result = await answer();
        expect(result.ok).toBe(false);
        expect(result.text).toContain('not a BluOS player');
    });

    it('will not call a player that still needs setting up connected', async () => {
        player = await servePlayer({ syncStatus: '<SyncStatus name="Spare" brand="NAD" model="C658" initialized="false"/>' });
        deck = await FakeDeck.launch();
        deck.appear('key-1', NOW_PLAYING, { address: player.address });
        deck.panelOpens('key-1', NOW_PLAYING);
        deck.fromPanel('key-1', NOW_PLAYING, { event: 'testConnection' });

        const result = await answer();
        expect(result.ok).toBe(false);
        expect(result.text).toContain('needs setting up');
    });

    // The rule the whole protocol rests on. The panel writes to the APP, which delivers to the
    // plugin, and the plugin checks what arrived. It never takes the panel's word for it.
    it('checks what the app delivered rather than what the panel said', async () => {
        player = await servePlayer();
        deck = await FakeDeck.launch();
        deck.appear('key-1', NOW_PLAYING, { address: player.address });
        deck.panelOpens('key-1', NOW_PLAYING);

        deck.panelWrites('key-1', { address: '' });
        await new Promise(resolve => setTimeout(resolve, 100));
        deck.fromPanel('key-1', NOW_PLAYING, { event: 'testConnection' });

        expect((await answer()).text).toContain('Enter the player');
        expect(player.requests).toEqual([]);
    });

    it('falls back to the default player for a key that has none of its own', async () => {
        player = await servePlayer();
        deck = await FakeDeck.launch();
        deck.panelWritesGlobal({ defaultAddress: player.address });
        await new Promise(resolve => setTimeout(resolve, 100));

        deck.appear('key-2', NOW_PLAYING);
        deck.panelOpens('key-2', NOW_PLAYING);
        deck.fromPanel('key-2', NOW_PLAYING, { event: 'testConnection' });

        expect((await answer()).ok).toBe(true);
    });

    it('says nothing to a panel that is not open', async () => {
        player = await servePlayer();
        deck = await FakeDeck.launch();
        deck.appear('key-1', NOW_PLAYING, { address: player.address });
        deck.fromPanel('key-1', NOW_PLAYING, { event: 'testConnection' });

        await new Promise(resolve => setTimeout(resolve, 400));
        expect(deck.received.some(m => m.event === 'sendToPropertyInspector')).toBe(false);
        expect(deck.faults).toBe('');
    });
});
