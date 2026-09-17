import { createHash } from 'node:crypto';

/**
 * A BluOS player, faked at the `fetch` seam.
 *
 * It implements the etag long-poll for real rather than pretending: a read carrying the current
 * etag HOLDS, unresolved, until the test changes something or the deadline passes. That is the only
 * way to test the behaviour the watcher turns on, which is that an unchanged answer is a success
 * that publishes nothing.
 *
 * A fake at the `fetch` seam rather than a real HTTP server, because the watcher's timing is what
 * is under test and vitest's fake timers cannot advance a real socket.
 */
export interface FakePlayerState {
    state?: string;
    title1?: string;
    title2?: string;
    twoline_title1?: string;
    twoline_title2?: string;
    volume?: number;
    mute?: 0 | 1;
    secs?: number;
    totlen?: number;
    streamUrl?: string;
    image?: string;
}

interface Held {
    resolve: (response: Response) => void;
    reject: (error: unknown) => void;
    signal: AbortSignal;
    onAbort: () => void;
}

export class FakePlayer {
    /** Every request path this player has been asked for, in order. */
    readonly requests: string[] = [];
    /** How many `/Status` reads are being held open right now. */
    get holding(): number {
        return this.held.length;
    }

    private state: FakePlayerState;
    private sync: Record<string, string>;
    private held: Held[] = [];
    /** Set to make the next reads fail, as an unplugged player would. */
    down: 'unreachable' | 'refused' | 'rejected' | 'garbage' | undefined;

    constructor(state: FakePlayerState = {}, sync: Record<string, string> = {}) {
        this.state = { state: 'play', title1: 'A track', title2: 'An artist', volume: 30, mute: 0, secs: 10, totlen: 200, ...state };
        this.sync = { name: 'Office', brand: 'NAD', model: 'M10', modelName: 'M10 V2', initialized: 'true', volume: '30', ...sync };
    }

    /** The current etag, computed from the state the way a player's would be. */
    get etag(): string {
        // `secs` is deliberately excluded, exactly as the specification says a player's is: "This
        // value is not used in the calculation of etag and progress will not of itself cause a
        // return from a long-polling call."
        const { secs: _secs, ...rest } = this.state;
        return createHash('md5').update(JSON.stringify(rest)).digest('hex');
    }

    /** Change what the player is doing, releasing anything holding on the old etag. */
    change(state: Partial<FakePlayerState>): void {
        this.state = { ...this.state, ...state };
        const waiting = this.held.splice(0);
        for (const one of waiting) {
            one.signal.removeEventListener('abort', one.onAbort);
            one.resolve(this.statusResponse());
        }
    }

    /** Advance the playhead WITHOUT moving the etag, which is what a real player does. */
    tick(seconds: number): void {
        this.state = { ...this.state, secs: (this.state.secs ?? 0) + seconds };
    }

    /** The `fetch` to hand a client. */
    get fetch(): typeof globalThis.fetch {
        return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = new URL(String(input));
            this.requests.push(url.pathname + url.search);
            const signal = init?.signal ?? undefined;
            if (signal?.aborted) throw abortError();

            if (this.down === 'unreachable') throw withCode(new TypeError('fetch failed'), 'ETIMEDOUT');
            if (this.down === 'refused') throw withCode(new TypeError('fetch failed'), 'ECONNREFUSED');
            if (this.down === 'rejected') return new Response('nope', { status: 503 });
            if (this.down === 'garbage') return new Response('<html><body>Router</body></html>', { status: 200 });

            if (url.pathname === '/SyncStatus') return this.syncResponse();
            if (url.pathname !== '/Status') return new Response(`<state>${this.state.state ?? 'play'}</state>`, { status: 200 });

            const asked = url.searchParams.get('etag');
            if (asked === null || asked !== this.etag) return this.statusResponse();

            // The etag matches, so the player holds until something changes or the caller gives up.
            return await new Promise<Response>((resolve, reject) => {
                const entry: Held = { resolve, reject, signal: signal as AbortSignal, onAbort: () => undefined };
                entry.onAbort = () => {
                    this.held = this.held.filter(one => one !== entry);
                    reject(abortError());
                };
                if (signal) signal.addEventListener('abort', entry.onAbort, { once: true });
                this.held.push(entry);
            });
        }) as typeof globalThis.fetch;
    }

    private statusResponse(): Response {
        const fields = Object.entries({ ...this.state, syncStat: this.sync.etag ?? '1' })
            .filter(([, value]) => value !== undefined)
            .map(([name, value]) => `<${name}>${value}</${name}>`)
            .join('\n');
        return new Response(`<status etag="${this.etag}">\n${fields}\n</status>`, { status: 200, headers: { 'content-type': 'application/xml' } });
    }

    private syncResponse(): Response {
        const attributes = Object.entries({ ...this.sync, etag: this.sync.etag ?? '1' })
            .map(([name, value]) => `${name}="${value}"`)
            .join(' ');
        return new Response(`<SyncStatus ${attributes}/>`, { status: 200, headers: { 'content-type': 'application/xml' } });
    }
}

function abortError(): Error {
    const error = new Error('This operation was aborted');
    error.name = 'AbortError';
    return error;
}

function withCode(error: Error, code: string): Error {
    (error as Error & { cause?: unknown }).cause = { code };
    return error;
}
