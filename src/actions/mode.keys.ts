import { describe } from '../bluos/connection.failure.js';
import type { StatusReading } from '../bluos/status.reading.js';
import { refuse, runCommand } from './command.outcome.js';
import { KeyControls } from './key.controls.js';

/** The manifest's shuffle states, in its order. */
export const SHUFFLE_OFF = 0;
export const SHUFFLE_ON = 1;

/**
 * The player's own repeat numbering, which is also the order of the manifest's states, and which is
 * NOT the order anybody would guess: 0 repeats the whole queue, 1 repeats one track, 2 is off.
 */
export const REPEAT_QUEUE = 0;
export const REPEAT_TRACK = 1;
export const REPEAT_OFF = 2;

/** What pressing repeat moves to: off, then the whole queue, then one track, then off again. */
const NEXT_REPEAT: Record<0 | 1 | 2, 0 | 1 | 2> = { [REPEAT_OFF]: REPEAT_QUEUE, [REPEAT_QUEUE]: REPEAT_TRACK, [REPEAT_TRACK]: REPEAT_OFF };

/**
 * Shuffle and repeat, which only mean something while the player is playing a queue.
 *
 * The specification: with a `streamUrl`, "shuffle and repeat are not relevant and should be removed
 * from any UI if possible". A Stream Deck key cannot be removed or greyed out, so it says "Stream" on
 * its face and declines a press there, as Next and Previous do on a station that offers nothing.
 *
 * Each press sends the state it means rather than a toggle, from the state the player last reported,
 * so a double press or a retry can never land somewhere unintended.
 */
abstract class QueueModeKeys extends KeyControls {
    protected abstract readonly name: string;
    protected abstract stateOf(status: StatusReading | undefined): number;
    protected abstract command(status: StatusReading): { path: string; query: Record<string, number> };

    async press(id: string): Promise<void> {
        const face = this.face(id);
        const reading = this.readingOf(id);
        const watcher = this.watcherOf(id);
        const status = reading.status;

        if (watcher === undefined || status === undefined || reading.stale) {
            await refuse(face, this.world.log, `${this.name} was pressed while ${describe(reading.failure ?? 'unreachable').sentence.toLowerCase()}`);
            return;
        }
        if (!status.queued) {
            await refuse(face, this.world.log, `${this.name} does nothing on a stream, which has no queue to shuffle or repeat.`);
            return;
        }

        const { path, query } = this.command(status);
        await runCommand(face, () => watcher.command((client, signal) => client.command(path, query, signal)), this.world.log);
    }

    protected override render(id: string): void {
        const reading = this.readingOf(id);
        const status = reading.status;
        const title = reading.failure !== undefined ? describe(reading.failure).title : status !== undefined && !status.queued ? 'Stream' : '';
        this.paint(id, { state: this.stateOf(status), title });
    }
}

export class ShuffleKeys extends QueueModeKeys {
    protected readonly name = 'Shuffle';

    protected stateOf(status: StatusReading | undefined): number {
        return status?.shuffle === true ? SHUFFLE_ON : SHUFFLE_OFF;
    }

    protected command(status: StatusReading): { path: string; query: Record<string, number> } {
        return { path: '/Shuffle', query: { state: status.shuffle === true ? 0 : 1 } };
    }
}

export class RepeatKeys extends QueueModeKeys {
    protected readonly name = 'Repeat';

    protected stateOf(status: StatusReading | undefined): number {
        return status?.repeat ?? REPEAT_OFF;
    }

    protected command(status: StatusReading): { path: string; query: Record<string, number> } {
        return { path: '/Repeat', query: { state: NEXT_REPEAT[status.repeat ?? REPEAT_OFF] } };
    }
}
