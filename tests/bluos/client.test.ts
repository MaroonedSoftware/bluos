import { describe, expect, it } from 'vitest';

import { BluOsClient, LONG_POLL_SECONDS } from '../../src/bluos/client.js';
import { classify } from '../../src/bluos/connection.failure.js';
import { FakePlayer } from '../fixtures/fake.player.js';

const never = new AbortController().signal;
const clientFor = (player: FakePlayer): BluOsClient =>
    new BluOsClient('http://player:11000', { userAgent: 'bluos-streamdeck/test', fetch: player.fetch });

describe('BluOsClient', () => {
    it('asks for the whole state when it has no etag', async () => {
        const player = new FakePlayer();
        const { reading, unchanged } = await clientFor(player).status(undefined, never);
        expect(player.requests[0]).toBe('/Status');
        expect(unchanged).toBe(false);
        expect(reading.firstLine).toBe('A track');
    });

    // Sixty, not the recommended hundred: a dead socket is only discovered at the deadline.
    // Measured on an NAD M10 V2 on 2026-09-17: a requested 60 is honoured, not clamped up.
    it('long-polls for sixty seconds when it has one', async () => {
        const player = new FakePlayer();
        const client = clientFor(player);
        const first = await client.status(undefined, never);
        player.change({ title1: 'B' });
        await client.status(first.reading.etag, never);
        expect(player.requests[1]).toBe(`/Status?timeout=${LONG_POLL_SECONDS}&etag=${first.reading.etag}`);
    });

    it('says when an answer carried the etag it was given', async () => {
        const player = new FakePlayer();
        const client = clientFor(player);
        const first = await client.status(undefined, never);
        // The fake holds on a matching etag, so ask with a stale one to get an immediate answer.
        const again = await client.status('an-old-etag', never);
        expect(again.unchanged).toBe(false);
        expect(again.reading.etag).toBe(first.reading.etag);
    });

    it('reads the player’s name and model', async () => {
        const sync = await clientFor(new FakePlayer()).syncStatus(never);
        expect(sync.name).toBe('Office');
        expect(sync.modelName).toBe('M10 V2');
    });

    it('names the plugin in its requests, so they are readable in a player’s logs', async () => {
        const seen: (RequestInit | undefined)[] = [];
        const player = new FakePlayer();
        const original = player.fetch;
        const client = new BluOsClient('http://player:11000', {
            userAgent: 'bluos-streamdeck/1.2.3',
            fetch: (async (input, init) => {
                seen.push(init);
                return await original(input, init);
            }) as typeof globalThis.fetch,
        });
        await client.status(undefined, never);
        expect((seen[0]?.headers as Record<string, string>)['User-Agent']).toBe('bluos-streamdeck/1.2.3');
    });

    describe('commands', () => {
        it('read the state the command produced, so no second request is needed', async () => {
            const player = new FakePlayer({ state: 'pause' });
            expect(await clientFor(player).command('/Pause', {}, never)).toEqual({ state: 'pause' });
        });

        it('read the level a volume command produced', async () => {
            const player = new FakePlayer();
            const client = new BluOsClient('http://player:11000', {
                userAgent: 'test',
                fetch: (async () => new Response('<volume db="-49.9" mute="0" offsetDb="0" etag="x">15</volume>')) as typeof globalThis.fetch,
            });
            expect(await client.command('/Volume', { level: 15 }, never)).toEqual({ volume: 15, muted: false });
            expect(player.requests).toEqual([]);
        });
    });

    describe('what it refuses', () => {
        it('calls an answer that is not XML from a player exactly that', async () => {
            const player = new FakePlayer();
            player.down = 'garbage';
            await expect(clientFor(player).status(undefined, never)).rejects.toThrow(/not like a BluOS player/);
        });

        it('tells a refused connection apart from no answer at all', async () => {
            const player = new FakePlayer();
            player.down = 'refused';
            await expect(
                clientFor(player)
                    .status(undefined, never)
                    .catch(error => classify(error)),
            ).resolves.toBe('refused');
            player.down = 'unreachable';
            await expect(
                clientFor(player)
                    .status(undefined, never)
                    .catch(error => classify(error)),
            ).resolves.toBe('unreachable');
        });

        it('treats an error status as the player refusing', async () => {
            const player = new FakePlayer();
            player.down = 'rejected';
            await expect(
                clientFor(player)
                    .status(undefined, never)
                    .catch(error => classify(error)),
            ).resolves.toBe('rejected');
        });
    });

    it('builds artwork URLs against the player it is pointed at', () => {
        const client = clientFor(new FakePlayer());
        expect(client.url('/Artwork?service=Deezer&songid=x', { followRedirects: 1 })).toBe(
            'http://player:11000/Artwork?service=Deezer&songid=x&followRedirects=1',
        );
    });
});
