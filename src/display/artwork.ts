import { urlFor } from '../bluos/address.js';
import type { StatusReading } from '../bluos/status.reading.js';

/**
 * Where a player's artwork actually lives.
 *
 * BluOS answers three shapes, and only the first is obvious. A path relative to the player
 * (`/Artwork?service=Deezer&songid=...`), which is what a local library or a player-cached cover
 * gives. An absolute URL at a streaming service's own origin, which is what the player this was
 * built against returned for every track it was watched playing. And, occasionally, a
 * protocol-relative `//host/path`, which a naive `^https?://` test treats as relative and resolves
 * into the nonsense `http://player//host/path`.
 *
 * `followRedirects=1` is added to a player path because the specification says so: "If the URL
 * starts with /Artwork it may result in redirect. Adding a parameter/key followRedirects=1 when
 * retrieving the image can avoid redirect."
 */
export function resolveArtworkUrl(origin: string, image: string | undefined): string | undefined {
    const path = image?.trim();
    if (path === undefined || path === '') return undefined;
    if (path.startsWith('//')) return `https:${path}`;
    if (/^https?:\/\//i.test(path)) return path;
    return urlFor(origin, path, path.startsWith('/Artwork') ? { followRedirects: 1 } : {});
}

/**
 * What a cover is remembered under.
 *
 * NOT the URL alone, and this is the trap worth naming. On internet radio a station's artwork path
 * is often fixed for the whole session while the art behind it changes with the stream's metadata,
 * so a cache keyed on the URL would freeze the cover on the first track and never update it. The
 * titles are what actually say the track changed.
 */
export function coverKey(origin: string, status: StatusReading | undefined): string | undefined {
    const url = resolveArtworkUrl(origin, status?.image ?? status?.stationImage);
    if (url === undefined) return undefined;
    return `${url}|${status?.firstLine ?? ''}|${status?.secondLine ?? ''}`;
}

/**
 * The image types a key can draw: the still ones Elgato lists for `setImage`. GIF is left out
 * because the app draws no animation, and anything else because a cover the app cannot decode would
 * draw as nothing at all rather than as the placeholder.
 */
const DRAWABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * What a file actually is, read off its first bytes.
 *
 * Needed because a player serving art from its own Vault or a NAS can answer
 * `application/octet-stream`, or no content type at all, and an allowlist alone would then draw the
 * placeholder for somebody's whole local library. The type is still checked first; this only steps
 * in where the player did not say.
 */
export function sniffImageType(bytes: Uint8Array): string | undefined {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return 'image/webp';
    }
    return undefined;
}

export interface ArtworkOptions {
    fetch?: typeof globalThis.fetch;
    userAgent: string;
    /**
     * Covers larger than this are drawn as the placeholder rather than sent to a 72-pixel key.
     *
     * The limit is not about bandwidth, which on a local network is free. The data URI travels over
     * the Stream Deck socket on every redraw, and base64 is a third larger again than the bytes.
     */
    maxBytes?: number;
    timeoutMs?: number;
    /** How many covers are remembered, which is a few tracks either side of the one playing. */
    capacity?: number;
}

/**
 * Covers as data URIs, fetched once each and remembered.
 *
 * A key shows one cover for minutes and redraws it every half second as the bar moves, so a cover is
 * fetched when its track starts and never again while it plays. A cover that could not be had is
 * remembered as such for the same reason: a service that answers 404 is asked once, not on every
 * redraw.
 */
export class ArtworkCache {
    private readonly get: typeof globalThis.fetch;
    private readonly options: Required<Omit<ArtworkOptions, 'fetch'>>;
    private readonly covers = new Map<string, string | undefined>();
    private readonly pending = new Map<string, Promise<string | undefined>>();

    constructor(options: ArtworkOptions) {
        this.get = options.fetch ?? globalThis.fetch;
        this.options = { maxBytes: 1024 * 1024, timeoutMs: 10_000, capacity: 8, ...options };
    }

    /** The cover if it has been fetched: a data URI, `undefined` for one that could not be had, or absent if never asked. */
    peek(key: string): { cover: string | undefined } | undefined {
        return this.covers.has(key) ? { cover: this.covers.get(key) } : undefined;
    }

    /** The cover, fetching it the first time and sharing one request between everybody who asks meanwhile. */
    async load(key: string, url: string): Promise<string | undefined> {
        const known = this.peek(key);
        if (known) return known.cover;
        const inFlight = this.pending.get(key);
        if (inFlight) return inFlight;

        const request = this.download(url).then(cover => {
            this.pending.delete(key);
            this.remember(key, cover);
            return cover;
        });
        this.pending.set(key, request);
        return request;
    }

    private async download(url: string): Promise<string | undefined> {
        try {
            const response = await this.get(url, {
                headers: { 'User-Agent': this.options.userAgent },
                signal: AbortSignal.timeout(this.options.timeoutMs),
            });
            if (!response.ok) return undefined;
            const declared = Number(response.headers.get('content-length'));
            if (Number.isFinite(declared) && declared > this.options.maxBytes) return undefined;

            const said = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.byteLength > this.options.maxBytes) return undefined;

            // What the player said, unless it said nothing useful, in which case what the bytes are.
            const type = DRAWABLE.has(said) ? said : sniffImageType(bytes);
            if (type === undefined) return undefined;
            return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
        } catch {
            return undefined;
        }
    }

    private remember(key: string, cover: string | undefined): void {
        this.covers.delete(key);
        this.covers.set(key, cover);
        while (this.covers.size > this.options.capacity) {
            const oldest = this.covers.keys().next().value;
            if (oldest === undefined) break;
            this.covers.delete(oldest);
        }
    }
}
