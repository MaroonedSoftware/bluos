import { describe, expect, it } from 'vitest';

import { describeProblem, parseAddress, urlFor } from '../../src/bluos/address.js';

describe('parseAddress', () => {
    // The one rule inverted from the sibling plugin: http, never https. A player on a home network
    // has no certificate, and upgrading silently would leave a key that cannot connect and no reason.
    it.each([
        ['192.168.1.100', 'http://192.168.1.100:11000'],
        ['  192.168.1.100  ', 'http://192.168.1.100:11000'],
        ['node.local', 'http://node.local:11000'],
        ['http://192.168.1.100', 'http://192.168.1.100:11000'],
        ['http://192.168.1.100:11000', 'http://192.168.1.100:11000'],
        // Port 11000 is not universal: the CI580 puts four nodes in one chassis on four ports.
        ['192.168.1.100:11010', 'http://192.168.1.100:11010'],
        ['http://192.168.1.100:11020/', 'http://192.168.1.100:11020'],
        // Somebody pasting the URL they were looking at rather than the player's address.
        ['192.168.1.100:11000/Status?timeout=100', 'http://192.168.1.100:11000'],
        // https is kept when it was asked for, rather than downgraded behind somebody's back.
        ['https://player.example.com', 'https://player.example.com:11000'],
    ])('reads %s as %s', (input, origin) => {
        expect(parseAddress(input)).toEqual({ origin });
    });

    it.each([
        [undefined, 'empty'],
        ['', 'empty'],
        ['   ', 'empty'],
        ['http://', 'empty'],
        ['ftp://192.168.1.100', 'notHttp'],
        ['http://[oops', 'malformed'],
    ])('refuses %s as %s', (input, problem) => {
        expect(parseAddress(input)).toEqual({ problem });
    });

    it('has words for every problem it can report', () => {
        for (const problem of ['empty', 'notHttp', 'malformed'] as const) {
            expect(describeProblem(problem).length).toBeGreaterThan(10);
        }
    });
});

describe('urlFor', () => {
    const origin = 'http://192.168.1.100:11000';

    it('builds a request against the player', () => {
        expect(urlFor(origin, '/Status')).toBe(`${origin}/Status`);
        expect(urlFor(origin, '/Status', { timeout: 60 })).toBe(`${origin}/Status?timeout=60`);
    });

    it('leaves out a parameter that was not given, rather than sending "undefined"', () => {
        expect(urlFor(origin, '/Status', { timeout: 60, etag: undefined })).toBe(`${origin}/Status?timeout=60`);
    });

    it('encodes a value rather than trusting it', () => {
        expect(urlFor(origin, '/Play', { url: 'https://example.com/a b.mp3' })).toContain('url=https%3A%2F%2Fexample.com%2Fa+b.mp3');
    });

    // Artwork paths arrive with a query already on them, which must survive being made absolute.
    it('keeps a query the path already carried', () => {
        expect(urlFor(origin, '/Artwork?service=Deezer&songid=x', { followRedirects: 1 })).toBe(
            `${origin}/Artwork?service=Deezer&songid=x&followRedirects=1`,
        );
    });
});
