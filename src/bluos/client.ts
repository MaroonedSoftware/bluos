import { urlFor } from './address.js';
import { NotAPlayer, PlayerRejected } from './connection.failure.js';
import { readInputs, type InputSource } from './inputs.reading.js';
import { readPresets, type PresetList } from './presets.reading.js';
import { readStatus, type StatusReading } from './status.reading.js';
import { readSyncStatus, type SyncReading } from './sync.reading.js';
import { attribute, parseXml, toNumber } from './xml.js';

/**
 * How long a long-poll may ask the player to hold, in seconds.
 *
 * The specification: "Recommended polling interval is 100 seconds and should be limited to a rate
 * of 60 seconds or so and never faster than 10 seconds." Sixty is taken rather than a hundred
 * because a dead socket is only discovered at the deadline, and a key that confidently shows a
 * reading from an unplugged player is the thing the stale marker exists to prevent. Measured
 * against an NAD M10 V2 on 2026-09-17: a requested 60 is honoured exactly, not clamped up to 100.
 */
export const LONG_POLL_SECONDS = 60;

/**
 * When a long-poll counts as having failed.
 *
 * Longer than what the player promised, or a healthy idle player would be cut off at the very
 * moment it was about to answer. Eight seconds of slack covers a busy player and a slow network.
 */
export const LONG_POLL_DEADLINE_MS = LONG_POLL_SECONDS * 1000 + 8_000;

/** When an ordinary request counts as having failed. Node's fetch sets no deadline of its own. */
export const REQUEST_DEADLINE_MS = 10_000;

/** What a `/Status` read produced, and whether anything in it moved. */
export interface StatusAnswer {
    reading: StatusReading;
    /**
     * The player answered with the same etag it was given, so nothing changed and there is nothing
     * new to draw. It is still a SUCCESS: the player is alive and the backoff must reset.
     */
    unchanged: boolean;
}

/** What a transport command answered with. Every command returns the state it produced. */
export interface CommandAnswer {
    state?: string;
    volume?: number;
    muted?: boolean;
}

export interface ClientOptions {
    /** Names the plugin in a player's logs, among whatever else is on the network. */
    userAgent: string;
    /** Swapped for a fake in tests. Defaults to the global `fetch`. */
    fetch?: typeof globalThis.fetch;
}

/**
 * One player's HTTP API.
 *
 * Every request in the plugin goes through here, so there is one place that knows the deadlines,
 * one that turns a non-200 into a failure, and one that decides what "not a player" looks like.
 *
 * It holds no state at all: no etag, no last reading, no timers. Those belong to the watcher, so
 * that pointing a key at another player is a matter of building another client rather than of
 * resetting this one correctly.
 */
export class BluOsClient {
    private readonly get: typeof globalThis.fetch;

    constructor(
        readonly origin: string,
        private readonly options: ClientOptions,
    ) {
        this.get = options.fetch ?? globalThis.fetch;
    }

    /**
     * Reads `/Status`, long-polling when given an etag.
     *
     * With no etag the player answers at once, which is what a first read and a read after waking
     * both want. With one it holds until something changes or the timeout runs out.
     */
    async status(etag: string | undefined, signal: AbortSignal): Promise<StatusAnswer> {
        const body = await this.read('/Status', etag === undefined ? {} : { timeout: LONG_POLL_SECONDS, etag }, signal);
        const reading = readStatus(body);
        if (!reading) throw new NotAPlayer(body.slice(0, 80).replace(/\s+/g, ' ').trim() || 'an empty answer');
        return { reading, unchanged: etag !== undefined && reading.etag === etag };
    }

    /**
     * Reads `/SyncStatus`, which carries the player's name, model and group.
     *
     * Never long-polled. The specification says one long-poll is enough because `/Status` carries a
     * `<syncStat>` element that changes whenever this response does, so this is read on demand.
     */
    async syncStatus(signal: AbortSignal): Promise<SyncReading> {
        const body = await this.read('/SyncStatus', {}, signal);
        const reading = readSyncStatus(body);
        if (!reading) throw new NotAPlayer(body.slice(0, 80).replace(/\s+/g, ' ').trim() || 'an empty answer');
        return reading;
    }

    /** Reads the player's presets. */
    async presets(signal: AbortSignal): Promise<PresetList> {
        const body = await this.read('/Presets', {}, signal);
        const list = readPresets(body);
        if (!list) throw new NotAPlayer(body.slice(0, 80).replace(/\s+/g, ' ').trim() || 'an empty answer');
        return list;
    }

    /** Reads the player's physical inputs, and those of any hub attached to it. */
    async inputs(signal: AbortSignal): Promise<InputSource[]> {
        const body = await this.read('/RadioBrowse', { service: 'Capture' }, signal);
        const inputs = readInputs(body);
        if (!inputs) throw new NotAPlayer(body.slice(0, 80).replace(/\s+/g, ' ').trim() || 'an empty answer');
        return inputs;
    }

    /**
     * Drives the player, and reads the state the command produced.
     *
     * Every transport command answers with `<state>` and every volume command with `<volume>`, so a
     * key updates from the command's own answer rather than by asking again. That is also why there
     * is no follow-up read schedule here: the long-poll wakes within milliseconds of the change.
     */
    async command(path: string, query: Record<string, string | number | undefined>, signal: AbortSignal): Promise<CommandAnswer> {
        const body = await this.read(path, query, signal);
        const root = parseXml(body);
        if (root?.name === 'volume') {
            const level = toNumber(root.text.trim());
            return {
                ...(level === undefined ? {} : { volume: level }),
                ...(attribute(root, 'mute') === undefined ? {} : { muted: attribute(root, 'mute') === '1' }),
            };
        }
        const state = root?.name === 'state' ? root.text.trim() : undefined;
        return state === undefined || state === '' ? {} : { state };
    }

    /** The URL a request would go to. Public so the cover cache can resolve an artwork path. */
    url(path: string, query: Record<string, string | number | undefined> = {}): string {
        return urlFor(this.origin, path, query);
    }

    private async read(path: string, query: Record<string, string | number | undefined>, signal: AbortSignal): Promise<string> {
        const response = await this.get(this.url(path, query), {
            signal,
            headers: { 'User-Agent': this.options.userAgent, Accept: 'application/xml, text/xml' },
        });
        if (!response.ok) throw new PlayerRejected(response.status);
        return await response.text();
    }
}
