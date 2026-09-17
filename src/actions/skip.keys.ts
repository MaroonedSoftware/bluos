import { describe } from '../bluos/connection.failure.js';
import { refuse, runCommand } from './command.outcome.js';
import { KeyControls } from './key.controls.js';

/** Which way a key moves through the queue. */
export type Direction = 'next' | 'previous';

/**
 * Next track and previous track.
 *
 * **They refuse a press while the player is on a stream, and that is the specification's rule
 * rather than a nicety.** A `streamUrl` in `/Status` means "the play queue is not the source of the
 * current audio" and that "next and previous are not available". Internet radio is the ordinary
 * case, not an edge one: the player this was built against was on a stream every time it was
 * looked at.
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

        if (!status.queued) {
            await refuse(face, this.world.log, `There is no ${this.direction} track: the player is on a stream rather than playing a queue.`);
            return;
        }

        await runCommand(
            face,
            () => watcher.command((client, signal) => client.command(this.direction === 'next' ? '/Skip' : '/Back', {}, signal)),
            this.world.log,
        );
    }

    protected override render(id: string): void {
        const reading = this.readingOf(id);
        // A key that cannot do anything says so, rather than looking ready and then refusing. It is
        // still pressable, because the Stream Deck has no disabled state for a key to sit in.
        const title =
            reading.failure !== undefined ? describe(reading.failure).title : reading.status !== undefined && !reading.status.queued ? 'Stream' : '';
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
