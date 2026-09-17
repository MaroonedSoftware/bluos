import { LONG_POLL_DEADLINE_MS, REQUEST_DEADLINE_MS, type BluOsClient, type CommandAnswer } from './client.js';
import { classify, type Failure } from './connection.failure.js';
import type { StatusReading } from './status.reading.js';
import type { SyncReading } from './sync.reading.js';

/** What every key pointed at this player draws from. */
export interface Reading {
    /** The last answer the player gave. Kept through a failure, because blanking it throws away something true. */
    status?: StatusReading;
    /** The player's name, model and group, refreshed when `syncStat` moves. */
    sync?: SyncReading;
    /** When `status` was read, in epoch milliseconds. Used to advance the playhead. */
    readAt?: number;
    /** Why the latest attempt failed. Absent when the player answered. */
    failure?: Failure;
    /** `status` is from before the latest attempt, which failed. */
    stale: boolean;
}

export interface WatcherOptions {
    /**
     * The least time between two reads of the same resource.
     *
     * The specification makes this a MUST: "a client must not make two consecutive requests for the
     * same resource less than one second apart, even if the first request returns in less than one
     * second." It is also the guard that matters most here. The success path is a loop with no
     * timer in it, so a player that answers instantly forever, or an etag that fails to chain,
     * would otherwise become a denial-of-service against somebody's stereo.
     */
    minGapMs?: number;
    /** The first wait after a failure. Doubles from here. */
    backoffMs?: number;
    /** The longest a failing player is left between attempts. */
    maxBackoffMs?: number;
    /**
     * How long the long-poll is kept open after the last key goes.
     *
     * A Stream Deck page change fires `willDisappear` for every key and `willAppear` for the next
     * page's a few milliseconds later. Without a pause here every page flip would tear down the
     * socket and cost a whole round trip with a visibly blank key.
     */
    lingerMs?: number;
    now?: () => number;
}

const DEFAULTS = { minGapMs: 1_000, backoffMs: 500, maxBackoffMs: 30_000, lingerMs: 2_000, now: () => Date.now() } as const;

/**
 * One player's state, long-polled, shared by every key pointed at it.
 *
 * The sibling plugin's `StatusPoller` runs a two-second timer because its station has no push
 * channel, and its own notes name this as the seam a feed would replace: "a feed replaces the
 * poller's timer and nothing else". BluOS has the feed. `/Status?timeout=60&etag=...` answers the
 * moment anything changes, so the timer is gone and an etag chain stands in its place. The
 * interface a key sees is unchanged.
 *
 * The behaviour that is easiest to get wrong, and has no counterpart in the sibling: **a read that
 * comes back with an unchanged etag is a success that publishes nothing**. Conflate the two and the
 * plugin fails in one of two quiet ways. Publish on every answer and a key flickers through
 * identical frames; treat an unchanged answer as "nothing happened" and the backoff never resets,
 * so a healthy player slowly degrades to thirty-second polling and a key that went stale never
 * comes back. So `markAlive` runs on every answer and `publish` only when something moved.
 */
export class StatusWatcher {
    private readonly options: Required<WatcherOptions>;
    private readonly listeners = new Set<(reading: Reading) => void>();
    private reading: Reading = { stale: false };
    private etag?: string;
    private holders = 0;
    private running = false;
    private cancel = new AbortController();
    private lingerTimer?: ReturnType<typeof setTimeout>;
    private sleeping?: { timer: ReturnType<typeof setTimeout>; wake: () => void };
    private failures = 0;
    private lastReadAt = 0;
    /** Bumped whenever the loop must stop, so an answer from an old one is dropped when it lands. */
    private generation = 0;

    constructor(
        readonly client: BluOsClient,
        options: WatcherOptions = {},
    ) {
        this.options = { ...DEFAULTS, ...options };
    }

    get current(): Reading {
        return this.reading;
    }

    /** Whether a long-poll is open. For the tests and for the pool's tidying. */
    get watching(): boolean {
        return this.running;
    }

    /** Hear every reading, starting with the current one, so a key appearing draws at once. */
    subscribe(listener: (reading: Reading) => void): () => void {
        this.listeners.add(listener);
        listener(this.reading);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** One more key wants readings. Returns its release, which is safe to call twice. */
    acquire(): () => void {
        this.holders += 1;
        clearTimeout(this.lingerTimer);
        this.lingerTimer = undefined;
        if (!this.running) void this.run();
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.holders -= 1;
            if (this.holders === 0) this.startLinger();
        };
    }

    /**
     * Start again from nothing, as after waking from sleep.
     *
     * Both halves matter. The in-flight read is ABORTED because a socket that slept through suspend
     * is dead and will not say so until the deadline, more than a minute away. And the etag is
     * DROPPED, because a read without one answers immediately with the current state, which is what
     * every key on the deck needs after the lid opens, and because a player that rebooted may have
     * reset its etags entirely.
     */
    refresh(): void {
        this.etag = undefined;
        this.failures = 0;
        this.stop();
        if (this.holders > 0) void this.run();
    }

    /**
     * Drives the player, and folds what the command answered into the reading.
     *
     * Every BluOS command answers with the state it produced, so a key flips the moment the player
     * agrees rather than a round trip later, and there is no follow-up read schedule of the kind
     * the sibling plugin needs: the long-poll wakes within milliseconds of the change anyway.
     *
     * A failure is thrown to the key that asked, for it to say so, and does not touch the reading.
     * A refused Skip says nothing about whether the player can be read.
     */
    async command(verb: (client: BluOsClient, signal: AbortSignal) => Promise<CommandAnswer>): Promise<CommandAnswer> {
        const answer = await verb(this.client, AbortSignal.timeout(REQUEST_DEADLINE_MS));
        this.note(answer);
        return answer;
    }

    /**
     * Folds a command's answer into the current reading and publishes it.
     *
     * Only what the answer actually carried: a transport command names a state and says nothing
     * about the volume, and a volume command the reverse. It does nothing at all before the first
     * reading has arrived, because there is no reading to fold into and inventing one would have a
     * key drawing a track it has never been told about.
     */
    private note(answer: CommandAnswer): void {
        const status = this.reading.status;
        if (status === undefined) return;
        if (answer.state === undefined && answer.volume === undefined && answer.muted === undefined) return;
        this.publish({
            ...this.reading,
            status: {
                ...status,
                ...(answer.state === undefined ? {} : { state: answer.state, playing: answer.state === 'play' || answer.state === 'stream' }),
                ...(answer.volume === undefined ? {} : { volume: answer.volume }),
                ...(answer.muted === undefined ? {} : { muted: answer.muted }),
            },
        });
    }

    /** Stops everything and forgets the loop. The reading is kept, because it was true when read. */
    dispose(): void {
        this.holders = 0;
        clearTimeout(this.lingerTimer);
        this.lingerTimer = undefined;
        this.stop();
        this.listeners.clear();
    }

    private startLinger(): void {
        clearTimeout(this.lingerTimer);
        this.lingerTimer = setTimeout(() => {
            this.lingerTimer = undefined;
            if (this.holders === 0) this.stop();
        }, this.options.lingerMs);
    }

    private stop(): void {
        this.generation += 1;
        this.running = false;
        this.cancel.abort();
        this.cancel = new AbortController();
        if (this.sleeping) {
            clearTimeout(this.sleeping.timer);
            const { wake } = this.sleeping;
            this.sleeping = undefined;
            wake();
        }
    }

    /** The read loop. One at a time, and only while a key is holding it. */
    private async run(): Promise<void> {
        if (this.running) return;
        this.running = true;
        const generation = this.generation;

        while (generation === this.generation && this.holders > 0) {
            const gap = this.gapBefore();
            if (gap > 0) {
                await this.sleep(gap);
                if (generation !== this.generation || this.holders === 0) break;
            }
            await this.readOnce(generation);
        }
        if (generation === this.generation) this.running = false;
    }

    /**
     * How long to wait before the next read.
     *
     * The floor is the specification's one second, measured from when the last read STARTED rather
     * than from when it finished, because that is what the rule says: two consecutive requests, not
     * two gaps between them. A failure waits longer, doubling to the cap.
     */
    private gapBefore(): number {
        const since = this.options.now() - this.lastReadAt;
        const floor = Math.max(0, this.options.minGapMs - since);
        if (this.failures === 0) return floor;
        const backoff = Math.min(this.options.backoffMs * 2 ** (this.failures - 1), this.options.maxBackoffMs);
        return Math.max(floor, backoff);
    }

    private async readOnce(generation: number): Promise<void> {
        this.lastReadAt = this.options.now();
        const signal = AbortSignal.any([
            this.cancel.signal,
            AbortSignal.timeout(this.etag === undefined ? REQUEST_DEADLINE_MS : LONG_POLL_DEADLINE_MS),
        ]);
        try {
            const { reading, unchanged } = await this.client.status(this.etag, signal);
            if (generation !== this.generation) return;
            this.etag = reading.etag;
            this.markAlive();
            if (unchanged) return;
            this.publish({ ...this.reading, status: reading, readAt: this.options.now(), failure: undefined, stale: false });
            await this.refreshSyncIfMoved(reading, generation);
        } catch (error) {
            if (generation !== this.generation) return;
            this.failures += 1;
            // The etag goes with the failure, and this is not tidiness. Retrying WITH it asks the
            // player to hold until something changes, so a player that came back but is still
            // playing the same thing would hold the socket for the full sixty seconds while every
            // key went on showing a stale reading. Without an etag the next read answers at once,
            // which both proves the player is back and brings whatever changed while it was away.
            this.etag = undefined;
            const { status, sync, readAt } = this.reading;
            this.publish({
                ...(status ? { status } : {}),
                ...(sync ? { sync } : {}),
                ...(readAt === undefined ? {} : { readAt }),
                failure: classify(error),
                stale: status !== undefined,
            });
        }
    }

    /**
     * The player answered, whatever it said.
     *
     * Resets the backoff, and un-stales a reading that a previous failure marked, so a key that
     * went pale comes back to life on an unchanged answer as much as on a changed one.
     */
    private markAlive(): void {
        this.failures = 0;
        if (this.reading.failure !== undefined || this.reading.stale) {
            this.publish({ ...this.reading, failure: undefined, stale: false });
        }
    }

    /**
     * Re-reads `/SyncStatus` when `/Status` says it moved.
     *
     * This is the mechanism the specification documents for covering both resources with one
     * long-poll. A failure here is swallowed on purpose: the player's name going stale is not worth
     * marking the whole reading stale over, and the `/Status` loop will report the player being
     * gone soon enough on its own.
     */
    private async refreshSyncIfMoved(status: StatusReading, generation: number): Promise<void> {
        if (status.syncStat !== undefined && status.syncStat === this.reading.sync?.etag) return;
        try {
            const sync = await this.client.syncStatus(AbortSignal.any([this.cancel.signal, AbortSignal.timeout(REQUEST_DEADLINE_MS)]));
            if (generation !== this.generation) return;
            this.publish({ ...this.reading, sync });
        } catch {
            // Left as it was; /Status is what says whether the player is there.
        }
    }

    /** Waits, interruptibly, so a release or a wake does not have to sit out a thirty-second backoff. */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                this.sleeping = undefined;
                resolve();
            }, ms);
            this.sleeping = { timer, wake: resolve };
        });
    }

    private publish(reading: Reading): void {
        this.reading = reading;
        for (const listener of [...this.listeners]) listener(reading);
    }
}
