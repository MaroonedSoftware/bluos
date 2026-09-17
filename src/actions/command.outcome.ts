import { classify, describe, type Failure } from '../bluos/connection.failure.js';

/** What a key says about a command, beyond the tick or the warning triangle on the key itself. */
export type Log = (sentence: string) => void;

/**
 * Runs a command a key was pressed for, and shows how it went on that key.
 *
 * A tick for done, the warning triangle for anything else, and the reason in the log: a key has no
 * room for a sentence, and whoever wants it opens the log from the Stream Deck app.
 *
 * `words` lets a command say what a failure means for IT, which a generic sentence cannot. The
 * difference between "the player did not answer" and "there is no next track on a radio stream" is
 * the difference between checking the network and understanding the player.
 */
export async function runCommand(
    face: { showOk(): Promise<void>; showAlert(): Promise<void> } | undefined,
    command: () => Promise<unknown>,
    log: Log,
    words: Partial<Record<Failure, string>> = {},
): Promise<boolean> {
    try {
        await command();
        await face?.showOk().catch(() => undefined);
        return true;
    } catch (error) {
        const failure = classify(error);
        log(words[failure] ?? describe(failure).sentence);
        await face?.showAlert().catch(() => undefined);
        return false;
    }
}

/**
 * Refuses a press, saying why.
 *
 * A Stream Deck key cannot be greyed out, so where a screen would disable a control a key has to
 * take the press and decline it. Doing nothing at all would read as the plugin being broken.
 */
export async function refuse(face: { showAlert(): Promise<void> } | undefined, log: Log, sentence: string): Promise<void> {
    log(sentence);
    await face?.showAlert().catch(() => undefined);
}
