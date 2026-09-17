import { describe, expect, it } from 'vitest';

import { probePlayer } from '../../src/bluos/probe.js';
import { FakePlayer } from '../fixtures/fake.player.js';

const options = (player: FakePlayer): { userAgent: string; fetch: typeof globalThis.fetch } => ({ userAgent: 'test', fetch: player.fetch });

describe('probePlayer', () => {
    // Naming the player back is the only answer that proves the right box was reached. Half the
    // addresses on a home network will answer something.
    it('names the player it found, and its model', async () => {
        const result = await probePlayer('192.168.1.234', options(new FakePlayer()));
        expect(result.ok).toBe(true);
        expect(result.text).toBe('Connected to Office (NAD M10 V2).');
    });

    it('says a player still needs setting up rather than calling it connected', async () => {
        const player = new FakePlayer({}, { initialized: 'false', name: '' });
        const result = await probePlayer('192.168.1.77', options(player));
        expect(result.ok).toBe(false);
        expect(result.text).toContain('needs setting up');
    });

    it('asks for an address before it asks the network', async () => {
        const player = new FakePlayer();
        const result = await probePlayer('   ', options(player));
        expect(result.ok).toBe(false);
        expect(player.requests).toEqual([]);
    });

    it('tells a wrong port apart from a player that is not there', async () => {
        const player = new FakePlayer();
        player.down = 'refused';
        expect((await probePlayer('192.168.1.234', options(player))).text).toContain('nothing is listening on that port');
        player.down = 'unreachable';
        expect((await probePlayer('192.168.1.234', options(player))).text).toContain('did not answer');
    });

    it('says when something answered but is not a player', async () => {
        const player = new FakePlayer();
        player.down = 'garbage';
        const result = await probePlayer('192.168.1.1', options(player));
        expect(result.ok).toBe(false);
        expect(result.text).toContain('not a BluOS player');
    });
});
