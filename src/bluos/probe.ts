import { parseAddress, describeProblem } from './address.js';
import { BluOsClient, REQUEST_DEADLINE_MS, type ClientOptions } from './client.js';
import { classify, describe } from './connection.failure.js';
import { describePlayer } from './sync.reading.js';

/** What a settings panel is told about the address it wrote. */
export interface ProbeResult {
    ok: boolean;
    /** A whole sentence, which is what the panel shows. */
    text: string;
}

/**
 * Checks an address by asking the player who it is.
 *
 * `/SyncStatus` rather than `/Status`, because it is the response that carries the player's name and
 * model, and naming the player back is the only answer that proves the right box was reached. "It
 * connected" is not worth much when half the addresses on a home network answer something.
 *
 * It runs on the settings the PLUGIN was handed, never on what the panel thinks it typed. The panel
 * writes, the Stream Deck app delivers, and the plugin checks what arrived, so what the panel shows
 * is about the settings the keys are actually using.
 */
export async function probePlayer(address: string | undefined, options: ClientOptions): Promise<ProbeResult> {
    const parsed = parseAddress(address);
    if ('problem' in parsed) return { ok: false, text: describeProblem(parsed.problem) };

    try {
        const sync = await new BluOsClient(parsed.origin, options).syncStatus(AbortSignal.timeout(REQUEST_DEADLINE_MS));
        if (!sync.initialized) {
            return {
                ok: false,
                text: `${describePlayer(sync)} answered, but it still needs setting up in the BluOS app before it can play anything.`,
            };
        }
        const model = [sync.brand, sync.modelName ?? sync.model].filter(Boolean).join(' ');
        return { ok: true, text: `Connected to ${describePlayer(sync)}${model ? ` (${model})` : ''}.` };
    } catch (error) {
        return { ok: false, text: describe(classify(error)).sentence };
    }
}
