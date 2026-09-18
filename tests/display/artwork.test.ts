import { describe, expect, it } from 'vitest';

import type { StatusReading } from '../../src/bluos/status.reading.js';
import { ArtworkCache, coverKey, resolveArtworkUrl, sniffImageType } from '../../src/display/artwork.js';

const ORIGIN = 'http://192.168.1.234:11000';
const status = (over: Partial<StatusReading> = {}): StatusReading => ({
    playing: true,
    fixedVolume: false,
    muted: false,
    canSeek: false,
    actions: {},
    queued: true,
    ...over,
});

describe('resolveArtworkUrl', () => {
    // The specification: a /Artwork path may redirect, and followRedirects=1 avoids it.
    it('resolves a player path and asks it not to redirect', () => {
        expect(resolveArtworkUrl(ORIGIN, '/Artwork?service=Deezer&songid=x')).toBe(`${ORIGIN}/Artwork?service=Deezer&songid=x&followRedirects=1`);
    });

    // What the real player returned for every track it was watched playing.
    it('leaves an absolute URL alone', () => {
        const cdn = 'https://radio.deanhome.app/api/art/ef20a0c0/cover.jpg';
        expect(resolveArtworkUrl(ORIGIN, cdn)).toBe(cdn);
    });

    // A naive ^https?:// test calls this relative and produces http://player//host/path.
    it('reads a protocol-relative URL as one', () => {
        expect(resolveArtworkUrl(ORIGIN, '//cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    });

    it('resolves a plain path without adding the redirect hint', () => {
        expect(resolveArtworkUrl(ORIGIN, '/Sources/images/TuneInIcon.png')).toBe(`${ORIGIN}/Sources/images/TuneInIcon.png`);
    });

    it('has nothing to resolve when the player named no image', () => {
        expect(resolveArtworkUrl(ORIGIN, undefined)).toBeUndefined();
        expect(resolveArtworkUrl(ORIGIN, '  ')).toBeUndefined();
    });
});

describe('coverKey', () => {
    // The trap: on radio the artwork path is often fixed for the session while the art behind it
    // changes with the metadata, so a URL-keyed cache freezes the cover on the first track.
    it('changes when the track changes, even behind an unchanged URL', () => {
        const url = '/Artwork?service=TuneIn';
        const first = coverKey(ORIGIN, status({ image: url, firstLine: 'Deadair', secondLine: 'Led Zeppelin' }));
        const second = coverKey(ORIGIN, status({ image: url, firstLine: 'Deadair', secondLine: 'Fleetwood Mac' }));
        expect(first).not.toBe(second);
    });

    it('stays the same for a redraw of the same track', () => {
        const track = status({ image: '/Artwork?x=1', firstLine: 'A', secondLine: 'B' });
        expect(coverKey(ORIGIN, track)).toBe(coverKey(ORIGIN, { ...track, secs: 99 }));
    });

    it('falls back to a station’s own image when there is no cover', () => {
        expect(coverKey(ORIGIN, status({ stationImage: '/Sources/images/x.png' }))).toContain('/Sources/images/x.png');
    });

    it('is nothing when the player named no image at all', () => {
        expect(coverKey(ORIGIN, status())).toBeUndefined();
    });
});

describe('sniffImageType', () => {
    it.each([
        ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]],
        ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]],
        ['image/webp', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
    ])('reads %s off the first bytes', (expected, bytes) => {
        expect(sniffImageType(new Uint8Array(bytes))).toBe(expected);
    });

    it('says nothing about what it does not recognise', () => {
        expect(sniffImageType(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBeUndefined();
        expect(sniffImageType(new Uint8Array([]))).toBeUndefined();
    });
});

/** A response with the given bytes and content type. */
function serving(bytes: number[], type?: string, extra: Record<string, string> = {}): typeof globalThis.fetch {
    return (async () =>
        new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { ...(type === undefined ? {} : { 'content-type': type }), ...extra },
        })) as typeof globalThis.fetch;
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8];

describe('ArtworkCache', () => {
    it('fetches a cover once and remembers it', async () => {
        let calls = 0;
        const underneath = serving(JPEG, 'image/jpeg');
        const cache = new ArtworkCache({
            userAgent: 'test',
            fetch: (async (...args: Parameters<typeof globalThis.fetch>) => {
                calls += 1;
                return await underneath(...args);
            }) as typeof globalThis.fetch,
        });

        const cover = await cache.load('k', 'http://player/art.jpg');
        expect(cover).toMatch(/^data:image\/jpeg;base64,/);
        expect(await cache.load('k', 'http://player/art.jpg')).toBe(cover);
        expect(calls).toBe(1);
    });

    it('shares one request between everybody who asks meanwhile', async () => {
        let calls = 0;
        const cache = new ArtworkCache({
            userAgent: 'test',
            fetch: (async () => {
                calls += 1;
                return new Response(new Uint8Array(JPEG), { headers: { 'content-type': 'image/jpeg' } });
            }) as typeof globalThis.fetch,
        });
        await Promise.all([cache.load('k', 'http://p/a.jpg'), cache.load('k', 'http://p/a.jpg'), cache.load('k', 'http://p/a.jpg')]);
        expect(calls).toBe(1);
    });

    // A service that answers 404 is asked once, not on every redraw.
    it('remembers a cover it could not have', async () => {
        let calls = 0;
        const cache = new ArtworkCache({
            userAgent: 'test',
            fetch: (async () => {
                calls += 1;
                return new Response('nope', { status: 404 });
            }) as typeof globalThis.fetch,
        });
        expect(await cache.load('k', 'http://p/a.jpg')).toBeUndefined();
        expect(await cache.load('k', 'http://p/a.jpg')).toBeUndefined();
        expect(calls).toBe(1);
        expect(cache.peek('k')).toEqual({ cover: undefined });
    });

    // A player serving art from a Vault can answer octet-stream, and an allowlist alone would draw
    // the placeholder for somebody's entire local library.
    it('takes the bytes’ word for it when the player did not say', async () => {
        const cache = new ArtworkCache({ userAgent: 'test', fetch: serving(JPEG, 'application/octet-stream') });
        expect(await cache.load('k', 'http://p/a')).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('takes the bytes’ word for it when the player said nothing at all', async () => {
        const cache = new ArtworkCache({ userAgent: 'test', fetch: serving(JPEG) });
        expect(await cache.load('k', 'http://p/a')).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('refuses something that is not an image it can draw', async () => {
        const cache = new ArtworkCache({ userAgent: 'test', fetch: serving([0x3c, 0x68, 0x74, 0x6d, 0x6c], 'text/html') });
        expect(await cache.load('k', 'http://p/a')).toBeUndefined();
    });

    // The data URI travels over the Stream Deck socket on every redraw, and base64 is a third
    // larger again than the bytes.
    it('refuses a cover too large to post down a socket repeatedly', async () => {
        const huge = new Array(200).fill(0);
        huge.splice(0, 4, 0xff, 0xd8, 0xff, 0xe0);
        const cache = new ArtworkCache({ userAgent: 'test', maxBytes: 100, fetch: serving(huge, 'image/jpeg') });
        expect(await cache.load('k', 'http://p/a')).toBeUndefined();
    });

    it('believes a declared length before it downloads anything', async () => {
        const cache = new ArtworkCache({ userAgent: 'test', maxBytes: 100, fetch: serving(JPEG, 'image/jpeg', { 'content-length': '999999' }) });
        expect(await cache.load('k', 'http://p/a')).toBeUndefined();
    });

    it('forgets the oldest covers rather than growing without end', async () => {
        const cache = new ArtworkCache({ userAgent: 'test', capacity: 2, fetch: serving(JPEG, 'image/jpeg') });
        await cache.load('a', 'http://p/a');
        await cache.load('b', 'http://p/b');
        await cache.load('c', 'http://p/c');
        expect(cache.peek('a')).toBeUndefined();
        expect(cache.peek('c')).toBeDefined();
    });

    it('never throws at the key that asked', async () => {
        const cache = new ArtworkCache({
            userAgent: 'test',
            fetch: (async () => {
                throw new Error('network');
            }) as typeof globalThis.fetch,
        });
        await expect(cache.load('k', 'http://p/a')).resolves.toBeUndefined();
    });
});
