/**
 * The least time between two writes starting.
 *
 * A dial can fire far faster than a player can answer, and a held key repeats every 120ms. This is
 * a floor rather than a debounce: the first move goes out at once so a single click feels instant.
 */
export const MIN_WRITE_GAP_MS = 60;

export interface WriterOptions {
    minGapMs?: number;
    now?: () => number;
}

/**
 * Sends volume changes to a player without flooding it, as a one-slot mailbox.
 *
 * The first move writes immediately. While that write is in flight, further moves only replace what
 * is in the mailbox, and when it clears, whatever is in the mailbox goes out. So the number of
 * writes self-tunes to how fast the player actually answers: a quick one gets many, a slow one gets
 * few, and the LAST value the user chose is always the one that lands.
 *
 * A fixed debounce is the obvious alternative and is worse. It sends nothing until the user pauses,
 * which makes a single click feel laggy, and on a slow player it still queues writes behind each
 * other because it knows nothing about what is in flight.
 */
export class VolumeWriter {
    private readonly minGapMs: number;
    private readonly now: () => number;
    private mailbox?: number;
    private inFlight = false;
    private lastStartedAt = 0;
    private timer?: ReturnType<typeof setTimeout>;

    constructor(
        private readonly send: (level: number) => Promise<void>,
        options: WriterOptions = {},
    ) {
        this.minGapMs = options.minGapMs ?? MIN_WRITE_GAP_MS;
        this.now = options.now ?? (() => Date.now());
    }

    /** Whether a write is in flight or waiting to go. */
    get busy(): boolean {
        return this.inFlight || this.mailbox !== undefined;
    }

    /** This is the level the player should be at. Supersedes anything not yet sent. */
    want(level: number): void {
        this.mailbox = level;
        this.pump();
    }

    /** Stops anything waiting to go, for a key that has left the deck. */
    cancel(): void {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.mailbox = undefined;
    }

    private pump(): void {
        if (this.inFlight || this.mailbox === undefined || this.timer !== undefined) return;
        const wait = this.lastStartedAt + this.minGapMs - this.now();
        if (wait > 0) {
            this.timer = setTimeout(() => {
                this.timer = undefined;
                this.pump();
            }, wait);
            return;
        }

        const level = this.mailbox;
        this.mailbox = undefined;
        this.inFlight = true;
        this.lastStartedAt = this.now();
        void this.send(level)
            .catch(() => undefined)
            .finally(() => {
                this.inFlight = false;
                this.pump();
            });
    }
}
