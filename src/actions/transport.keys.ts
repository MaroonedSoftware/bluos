import { describe } from '../bluos/connection.failure.js';
import { refuse, runCommand } from './command.outcome.js';
import { PlayerKeys } from './player.keys.js';

/** The manifest's two states, in its order. */
export const PAUSE = 0;
export const PLAY = 1;

/**
 * Play or pause: one key, drawn as whichever it would do next.
 *
 * **Absolute commands only.** `/Pause?toggle=1` exists and is not used, here or anywhere in this
 * plugin. The state is known from the reading, so the key issues the verb it means, and a double
 * press or a retry can never invert what it asked for. The same rule settles the volume, which is
 * written as a level and never as a relative step.
 *
 * There is no arming, unlike the sibling plugin's Stop. That key guards a live radio station going
 * off air; pausing a speaker is undone by pressing again.
 */
export class TransportKeys extends PlayerKeys {
    async press(id: string): Promise<void> {
        const face = this.face(id);
        const reading = this.readingOf(id);
        const watcher = this.watcherOf(id);
        const status = reading.status;

        if (watcher === undefined || status === undefined || reading.stale) {
            await refuse(
                face,
                this.world.log,
                `Play or pause was pressed while ${describe(reading.failure ?? 'unreachable').sentence.toLowerCase()}`,
            );
            return;
        }

        const playing = status.playing;
        await runCommand(
            face,
            () => watcher.command((client, signal) => client.command(playing ? '/Pause' : '/Play', {}, signal)),
            this.world.log,
            // The specification: "/Play can be used to resume when in a pause state but not when in
            // stop state." A player that is stopped has nothing loaded to resume.
            {
                rejected: playing
                    ? 'The player refused to pause.'
                    : 'The player refused to play. A stopped player has nothing to resume; choose something in the BluOS app first.',
            },
        );
    }

    protected override render(id: string): void {
        const reading = this.readingOf(id);
        const playing = reading.status?.playing ?? false;
        this.paint(id, {
            state: playing ? PAUSE : PLAY,
            title: reading.failure === undefined ? '' : describe(reading.failure).title,
        });
    }
}
