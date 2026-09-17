/**
 * Why a player is not answering, told apart by how it is fixed.
 *
 * The sibling plugin's file of this name states the criterion and it is the right one: two failures
 * are different when the person reading the key would do something different about them. A wrong
 * port and a player that is switched off both look like "no answer" from inside a `fetch`, and they
 * are fixed in completely different places.
 *
 * There is no `unauthorised` here and no rate limiting. BluOS has no credentials at all, and the
 * specification sets a polling floor rather than returning 429, so the sibling plugin's
 * `retryAfterMs` has no counterpart.
 */
export type Failure =
    /** No player has been chosen yet, or what was typed is not an address. */
    | 'unconfigured'
    /** Nothing answered: the wrong address, or a player that is switched off or asleep. */
    | 'unreachable'
    /** The host is there and refused the connection, so the port is wrong or the player is booting. */
    | 'refused'
    /** Something answered, but not a BluOS player: a router's web page, or the wrong device entirely. */
    | 'notAPlayer'
    /** The player answered with an error status. */
    | 'rejected';

/** Thrown when a command is asked for and no player has been chosen. */
export class NotConfigured extends Error {
    constructor() {
        super('No BluOS player has been chosen for this key.');
        this.name = 'NotConfigured';
    }
}

/** Thrown when a player answers, but with a status that is not success. */
export class PlayerRejected extends Error {
    constructor(readonly status: number) {
        super(`The player answered ${status}.`);
        this.name = 'PlayerRejected';
    }
}

/** Thrown when something answers on the player's port but does not speak BluOS. */
export class NotAPlayer extends Error {
    constructor(what: string) {
        super(`That address answered, but not like a BluOS player: ${what}`);
        this.name = 'NotAPlayer';
    }
}

/**
 * Which failure an error is.
 *
 * Node's `fetch` wraps the real cause, so the code is read off `error.cause` as well as off the
 * error itself. An `AbortError` counts as unreachable: from a key's side, a player that accepted
 * the connection and then said nothing until the deadline is a player that did not answer.
 */
export function classify(error: unknown): Failure {
    if (error instanceof NotConfigured) return 'unconfigured';
    if (error instanceof NotAPlayer) return 'notAPlayer';
    if (error instanceof PlayerRejected) return 'rejected';

    const code = codeOf(error);
    if (code === 'ECONNREFUSED') return 'refused';
    return 'unreachable';
}

function codeOf(error: unknown): string | undefined {
    for (let at: unknown = error, depth = 0; at !== undefined && at !== null && depth < 5; depth++) {
        const code = (at as { code?: unknown }).code;
        if (typeof code === 'string') return code;
        at = (at as { cause?: unknown }).cause;
    }
    return undefined;
}

/** What a key can show, and what a log can say. */
export interface Described {
    /** Short enough for a key, which has room for about a dozen characters. */
    title: string;
    /** A whole sentence, for the log and the settings panel. */
    sentence: string;
}

export function describe(failure: Failure): Described {
    switch (failure) {
        case 'unconfigured':
            return { title: 'No player', sentence: 'No BluOS player has been chosen for this key yet.' };
        case 'unreachable':
            return { title: 'No answer', sentence: 'The player did not answer. It may be switched off, asleep, or at another address now.' };
        case 'refused':
            return {
                title: 'Refused',
                sentence:
                    'The player’s address is reachable but nothing is listening on that port. Check the port, or wait for it to finish starting up.',
            };
        case 'notAPlayer':
            return { title: 'Not a player', sentence: 'Something answered at that address, but it is not a BluOS player.' };
        case 'rejected':
            return { title: 'Refused', sentence: 'The player refused the request.' };
    }
}
