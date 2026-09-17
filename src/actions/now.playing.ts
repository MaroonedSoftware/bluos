import { describe } from '../bluos/connection.failure.js';
import type { Reading } from '../bluos/status.watcher.js';
import { PlayerKeys } from './player.keys.js';

/**
 * What a Now Playing key shows.
 *
 * Words only, for now. The cover, the playhead and the SVG the key is really drawn from come later;
 * what this settles is that each key follows ITS OWN player, which is the thing worth being sure of
 * before anything is drawn on top of it.
 */
export function wordsFor(reading: Reading): string {
    if (reading.failure !== undefined) return describe(reading.failure).title;
    const status = reading.status;
    if (status === undefined) return '';
    const lines = [status.firstLine, status.secondLine].filter((line): line is string => line !== undefined && line !== '');
    if (lines.length === 0) return status.playing ? 'Playing' : (status.state ?? '');
    // A key is about seventy pixels wide, so the two lines are stacked rather than run together.
    return lines.join('\n');
}

export class NowPlayingKeys extends PlayerKeys {
    protected override render(id: string): void {
        this.paint(id, { title: wordsFor(this.readingOf(id)) });
    }
}
