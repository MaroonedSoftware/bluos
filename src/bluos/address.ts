/**
 * Where a player is, as somebody typed it or as discovery found it.
 *
 * The rules mirror the sibling plugin's `parseAddress` with ONE inverted: a bare host becomes
 * `http://`, never `https://`. A BluOS player on a home network has no certificate, and silently
 * upgrading would leave a key that cannot connect and no reason why. The sibling plugin talks to a
 * station on the internet, where the opposite default is the right one.
 */

/** The default port, which is right for every player except one. */
export const DEFAULT_PORT = 11000;

/** Why what was typed is not an address. */
export type AddressProblem = 'empty' | 'notHttp' | 'malformed';

export type ParsedAddress = { origin: string } | { problem: AddressProblem };

/**
 * Reads an address.
 *
 * A bare host gets `http://` and port 11000. A port that was typed is kept, because port 11000 is
 * NOT universal: the specification records that the CI580 puts four streamer nodes in one chassis,
 * where only the first is on 11000. A path, a query and a fragment are dropped, because the BluOS
 * API is served from the root and anything after the host is somebody pasting a URL they were
 * looking at rather than the player's address.
 */
export function parseAddress(input: string | undefined): ParsedAddress {
    const trimmed = (input ?? '').trim();
    if (trimmed === '') return { problem: 'empty' };

    // A bare `host:11000` would otherwise parse as the scheme "host", so the scheme test looks for
    // `://` rather than for a colon.
    const withScheme = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
    if (withScheme.slice(withScheme.indexOf('://') + 3).trim() === '') return { problem: 'empty' };

    let url: URL;
    try {
        url = new URL(withScheme);
    } catch {
        return { problem: 'malformed' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { problem: 'notHttp' };
    if (url.hostname === '') return { problem: 'empty' };

    // Built from its parts rather than from `url.href`, which would carry a user and password along.
    const port = url.port === '' ? DEFAULT_PORT : Number(url.port);
    return { origin: `${url.protocol}//${url.hostname}:${port}` };
}

/** The address of a player, or `undefined` while what was typed is not one. */
export function originFrom(input: string | undefined): string | undefined {
    const parsed = parseAddress(input);
    return 'origin' in parsed ? parsed.origin : undefined;
}

/** What to tell somebody about an address that does not read. */
export function describeProblem(problem: AddressProblem): string {
    switch (problem) {
        case 'empty':
            return 'Enter the player’s address, for example 192.168.1.100.';
        case 'notHttp':
            return 'A player’s address starts with http:// or is just its host.';
        case 'malformed':
            return 'That is not an address. A player’s is its IP, or its name ending in .local.';
    }
}

/**
 * A URL for a request against a player.
 *
 * Every call goes through here, so there is one place that knows an origin and a path become a URL,
 * and one place a query is built. Values are encoded by `URL`, which matters for `/Play?url=` and
 * for artwork paths that already carry a query of their own.
 */
export function urlFor(origin: string, path: string, query: Record<string, string | number | undefined> = {}): string {
    const url = new URL(path, `${origin}/`);
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
}
