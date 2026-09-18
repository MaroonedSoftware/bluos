import { describe } from '../bluos/connection.failure.js';
import { refuse, runCommand } from './command.outcome.js';
import { KeyControls } from './key.controls.js';

/** The manifest's states: a heart that can be pressed, and a faint one where the station has no love. */
export const LOVE_AVAILABLE = 0;
export const LOVE_UNAVAILABLE = 1;

/**
 * Marks the track playing as liked, on a streaming station that offers it.
 *
 * Section 4.8: a station that lets a listener love a track lists `<action name="love" url="...">` in
 * `/Status`, and the client asks that URL. Slacker, Radio Paradise and Amazon's stations are the
 * specification's examples. Most sources offer nothing of the kind, and the heart says so by going
 * faint rather than by refusing a press that looked ready.
 *
 * Ban, the same section's other action, is left out on purpose: it skips the track and tells the
 * service to never play it again, which is too much to hang off a key pressed without looking.
 */
export class LoveKeys extends KeyControls {
    async press(id: string): Promise<void> {
        const face = this.face(id);
        const reading = this.readingOf(id);
        const watcher = this.watcherOf(id);
        const url = reading.status?.actions.love;

        if (watcher === undefined || reading.status === undefined || reading.stale) {
            await refuse(face, this.world.log, `Love was pressed while ${describe(reading.failure ?? 'unreachable').sentence.toLowerCase()}`);
            return;
        }
        if (url === undefined) {
            await refuse(face, this.world.log, 'This station does not offer a way to love a track.');
            return;
        }

        await runCommand(face, () => watcher.command((client, signal) => client.command(url, {}, signal)), this.world.log);
    }

    protected override render(id: string): void {
        const reading = this.readingOf(id);
        this.paint(id, {
            state: reading.status?.actions.love === undefined || reading.stale ? LOVE_UNAVAILABLE : LOVE_AVAILABLE,
            title: reading.failure === undefined ? '' : describe(reading.failure).title,
        });
    }
}
