import { describe } from '../bluos/connection.failure.js';
import type { StatusReading } from '../bluos/status.reading.js';
import { refuse, runCommand } from './command.outcome.js';
import { KeyControls } from './key.controls.js';

/** Which way a key moves through the queue. */
export type Direction = 'next' | 'previous';

/**
 * Next track and previous track.
 *
 * Playing a queue, they send `/Skip` and `/Back`. On a stream the queue is not the source, and the
 * specification says "next and previous are not available (but see also actions)". The part in
 * brackets matters: a station that CAN skip says so with an `<action name="skip" url="...">`, and
 * the key asks that URL. Only a stream that offers nothing is refused.
 *
 * An earlier version refused every stream, having quoted the specification without its brackets.
 *
 * Where a screen would disable the control, a Stream Deck key cannot be greyed out, so it takes the
 * press and declines it. The warning triangle says something happened; the log says what.
 */
export abstract class SkipKeys extends KeyControls {
    async press(id: string): Promise<void> {
        const face = this.face(id);
        const reading = this.readingOf(id);
        const watcher = this.watcherOf(id);
        const status = reading.status;

        if (watcher === undefined || status === undefined || reading.stale) {
            await refuse(
                face,
                this.world.log,
                `${this.what()} was pressed while ${describe(reading.failure ?? 'unreachable').sentence.toLowerCase()}`,
            );
            return;
        }

        const target = this.target(status);
        if (target === undefined) {
            await refuse(face, this.world.log, `There is no ${this.direction} track: this station does not offer one.`);
            return;
        }

        await runCommand(face, () => watcher.command((client, signal) => client.command(target, {}, signal)), this.world.log);
    }

    /** Where to ask: the queue's own verb, the station's action, or nowhere. */
    private target(status: StatusReading): string | undefined {
        if (status.queued) return this.direction === 'next' ? '/Skip' : '/Back';
        return this.direction === 'next' ? status.actions.skip : status.actions.back;
    }

    protected override render(id: string): void {
        const reading = this.readingOf(id);
        // A key that cannot do anything says so, rather than looking ready and then refusing. It is
        // still pressable, because the Stream Deck has no disabled state for a key to sit in.
        const status = reading.status;
        const title =
            reading.failure !== undefined
                ? describe(reading.failure).title
                : status !== undefined && this.target(status) === undefined
                  ? 'Stream'
                  : '';
        this.paint(id, { title });
    }

    protected abstract get direction(): Direction;

    private what(): string {
        return this.direction === 'next' ? 'Next track' : 'Previous track';
    }
}

export class NextKeys extends SkipKeys {
    protected override get direction(): Direction {
        return 'next';
    }
}

export class PreviousKeys extends SkipKeys {
    protected override get direction(): Direction {
        return 'previous';
    }
}
