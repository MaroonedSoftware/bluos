import { describe } from '../bluos/connection.failure.js';
import { refuse, runCommand } from './command.outcome.js';
import { KeyControls } from './key.controls.js';

/**
 * Stops the player, which is the honest version of a power-off key.
 *
 * BluOS has no power command. A stopped player drops into network standby on its own after a few
 * minutes (an NAD M10 V2 uses under four watts there) and wakes as soon as anything asks it to play.
 * So this key says Stop rather than Power: nothing in `/Status` reports whether a player is in
 * standby, and a key claiming to show "on" or "off" would be guessing.
 *
 * Unlike Pause, a stopped player cannot be resumed with `/Play` (the specification says so), which
 * is why this is its own key rather than a mode of Play or Pause.
 */
export class StopKeys extends KeyControls {
    async press(id: string): Promise<void> {
        const face = this.face(id);
        const reading = this.readingOf(id);
        const watcher = this.watcherOf(id);

        if (watcher === undefined || reading.status === undefined || reading.stale) {
            await refuse(face, this.world.log, `Stop was pressed while ${describe(reading.failure ?? 'unreachable').sentence.toLowerCase()}`);
            return;
        }
        await runCommand(face, () => watcher.command((client, signal) => client.command('/Stop', {}, signal)), this.world.log);
    }

    protected override render(id: string): void {
        const reading = this.readingOf(id);
        this.paint(id, { title: reading.failure === undefined ? '' : describe(reading.failure).title });
    }
}
