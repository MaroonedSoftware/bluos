import { afterEach, describe, expect, it } from 'vitest';

import { NOW_PLAYING, PRESET } from '../../src/actions/action.ids.js';
import { isPresetListAnswer, isToInspector } from '../../src/inspector/inspector.messages.js';
import { SPEC_PRESETS } from '../fixtures/bluos.xml.js';
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
        // The key is watching the player too by now, so the check's own request is among them
        // rather than first.
        expect(player.requests).toContain('/SyncStatus');
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

        // Let the key settle ON THE PLAYER first. The first title a key draws is "No player",
        // before it has asked anything, so waiting for any title at all would wait for nothing.
        await deck.next(message => message.event === 'setTitle' && String((message.payload as { title?: string })?.title ?? '').includes('Deadair'));

        // From here, so that a frame the key drew at startup cannot stand in for a new one.
        const mark = deck.mark;
        deck.panelWrites('key-1', { address: '' });
        deck.fromPanel('key-1', NOW_PLAYING, { event: 'testConnection' });

        // The panel believes the key still points at a player. The plugin was handed settings that
        // say otherwise, and answers about those.
        const said = await deck.next(m => m.event === 'sendToPropertyInspector' && isToInspector(m.payload), mark);
        expect((said.payload as unknown as { text: string }).text).toContain('Enter the player');
        // And the key itself followed the same settings, rather than staying where the panel left it.
        const back = await deck.next(m => m.event === 'setTitle' && (m.payload as { title?: string })?.title === 'No player', mark);
        expect((back.payload as { title: string }).title).toBe('No player');
    });

    it('falls back to the default player for a key that has none of its own', async () => {
        player = await servePlayer();
        deck = await FakeDeck.launch();
        deck.panelWritesGlobal({ defaultAddress: player.address });
        await new Promise(resolve => setTimeout(resolve, 100));

        deck.appear('key-2', NOW_PLAYING);
        deck.panelOpens('key-2', NOW_PLAYING);
        deck.fromPanel('key-2', NOW_PLAYING, { event: 'testConnection' });

        expect(await answer()).toEqual({ event: 'connection', ok: true, text: 'Connected to Office (NAD M10 V2).' });
    });

    // The panel is a Chromium page and cannot reach the player, so the plugin reads the list for it.
    it('lists the key’s player’s presets for the panel', async () => {
        player = await servePlayer({ presets: SPEC_PRESETS });
        deck = await FakeDeck.launch();
        deck.appear('key-1', PRESET, { address: player.address });
        deck.panelOpens('key-1', PRESET);
        deck.fromPanel('key-1', PRESET, { event: 'presets' });

        const message = await deck.next(m => m.event === 'sendToPropertyInspector' && isPresetListAnswer(m.payload));
        expect(message.payload).toEqual({
            event: 'presetList',
            presets: [
                { id: 6, name: 'Serenity' },
                { id: 7, name: '1980s Alternative Rock Classics' },
            ],
        });
    });

    it('explains an empty list rather than showing an empty box', async () => {
        deck = await FakeDeck.launch();
        deck.appear('key-1', PRESET);
        deck.panelOpens('key-1', PRESET);
        deck.fromPanel('key-1', PRESET, { event: 'presets' });

        const message = await deck.next(m => m.event === 'sendToPropertyInspector' && isPresetListAnswer(m.payload));
        expect((message.payload as { problem?: string }).problem).toContain('Choose a player first');
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
