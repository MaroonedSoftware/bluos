import { describe } from '../bluos/connection.failure.js';
import { refuse, runCommand } from './command.outcome.js';
import { KeyControls } from './key.controls.js';

/** The manifest's states: no timer, and a timer running. */
export const SLEEP_OFF = 0;
export const SLEEP_ON = 1;

/**
 * The player's sleep timer, which is the nearest thing BluOS has to a power switch.
 *
 * The public API has no power or standby command at all. A player drops into network standby on
 * its own some minutes after it stops, and wakes the moment anything asks it to play, so "off" is a
 * sleep timer or a Stop, and "on" is any preset or input key.
 *
 * `/Sleep` is not in the specification. It was measured on an NAD M10 V2 on 2026-09-18: from no
 * timer it answered `<sleep>15</sleep>`, the player's first step. Each press moves the timer on a
 * step, and the key shows whatever the player answers rather than assuming which steps it has, so a
 * player with a different set of steps is shown correctly too.
 */
export class SleepKeys extends KeyControls {
    async press(id: string): Promise<void> {
        const face = this.face(id);
        const reading = this.readingOf(id);
        const watcher = this.watcherOf(id);

        if (watcher === undefined || reading.status === undefined || reading.stale) {
            await refuse(
                face,
                this.world.log,
                `The sleep timer was pressed while ${describe(reading.failure ?? 'unreachable').sentence.toLowerCase()}`,
            );
            return;
        }
        await runCommand(face, () => watcher.command((client, signal) => client.command('/Sleep', {}, signal)), this.world.log);
    }

    protected override render(id: string): void {
        const reading = this.readingOf(id);
        const minutes = reading.status?.sleep;
        const title =
            reading.failure !== undefined
                ? describe(reading.failure).title
                : reading.status === undefined
                  ? ''
                  : minutes === undefined
                    ? 'Off'
                    : `${minutes} min`;
        this.paint(id, { state: minutes === undefined ? SLEEP_OFF : SLEEP_ON, title });
    }
}
