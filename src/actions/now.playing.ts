import { describe } from '../bluos/connection.failure.js';
import type { Reading } from '../bluos/status.watcher.js';
import { coverKey, resolveArtworkUrl, type ArtworkCache } from '../display/artwork.js';
import { asKeyImage, nowPlayingSvg, progressStep } from '../display/key.image.js';
import { PlayheadClock, projectPlayhead, TICK_MS } from '../display/playhead.js';
import type { KeyFace } from './key.face.js';
import { optionsFrom, SHOW_EVERYTHING, type NowPlayingKeySettings, type NowPlayingOptions } from './now.playing.options.js';
import { PlayerKeys, type KeysWorld } from './player.keys.js';

/**
 * The words a Now Playing key shows.
 *
 * The two lines the player says to use, or the plugin's own words for why it cannot say. A failure's
 * words are never suppressed by the title option: turning the title off is a choice about the
 * TRACK's name, and a silently blank key that is actually disconnected would say nothing true.
 */
export function wordsFor(reading: Reading, options: NowPlayingOptions = SHOW_EVERYTHING): string {
    if (reading.failure !== undefined) return describe(reading.failure).title;
    const status = reading.status;
    if (status === undefined) return '';
    if (!options.title) return '';
    const lines = [status.firstLine, status.secondLine].filter((line): line is string => line !== undefined && line !== '');
    if (lines.length === 0) return status.playing ? 'Playing' : (status.state ?? '');
    return lines.join('\n');
}

interface Drawn {
    options: NowPlayingOptions;
    clock: PlayheadClock;
    /** The cover key this key is showing, so a fetch that lands late for another track is dropped. */
    wanted?: string;
}

/**
 * What a Now Playing key draws: the cover, the two lines, and a bar that moves between readings.
 *
 * The bar is why this key has a timer where nothing else in the plugin does. `secs` is deliberately
 * left out of the player's etag, so a long-poll that only answers on a change would leave the bar
 * frozen for the length of a track. The specification says as much and puts the job on the client.
 */
export class NowPlayingKeys extends PlayerKeys {
    private readonly drawn = new Map<string, Drawn>();
    private ticker?: ReturnType<typeof setInterval>;

    constructor(
        world: KeysWorld,
        private readonly artwork: ArtworkCache,
    ) {
        super(world);
    }

    override appear(face: KeyFace, settings: NowPlayingKeySettings): void {
        this.drawn.set(face.id, { options: optionsFrom(settings), clock: new PlayheadClock() });
        super.appear(face, settings);
        this.startTicking();
    }

    override disappear(id: string): void {
        this.drawn.delete(id);
        super.disappear(id);
        if (this.drawn.size === 0) this.stopTicking();
    }

    override settingsChanged(id: string, settings: NowPlayingKeySettings): void {
        const drawn = this.drawn.get(id);
        if (drawn !== undefined) drawn.options = optionsFrom(settings);
        super.settingsChanged(id, settings);
        // The player may not have moved, but the options may have, so this key is redrawn either way.
        this.render(id);
    }

    protected override render(id: string): void {
        const drawn = this.drawn.get(id);
        if (drawn === undefined) return;
        const reading = this.readingOf(id);
        const status = reading.status;
        const options = drawn.options;

        const key = this.coverWanted(id, status ? reading : undefined);
        drawn.wanted = key;
        const cover = key === undefined ? undefined : this.artwork.peek(key)?.cover;
        if (key !== undefined && this.artwork.peek(key) === undefined) void this.fetchCover(id, key);

        const playhead = options.progress ? projectPlayhead(status, drawn.clock.carriedFor(status)) : undefined;

        this.paint(id, {
            title: wordsFor(reading, options),
            image: asKeyImage(
                nowPlayingSvg({
                    ...(cover === undefined ? {} : { cover }),
                    ...(playhead === undefined ? {} : { step: progressStep(playhead.fraction) }),
                    stale: reading.stale,
                    shade: options.title,
                }),
            ),
        });
    }

    private coverWanted(id: string, reading: Reading | undefined): string | undefined {
        const origin = this.originOf(id);
        if (origin === undefined || reading?.status === undefined) return undefined;
        return coverKey(origin, reading.status);
    }

    /** Fetches a cover, and redraws the key only if it still wants that one when it lands. */
    private async fetchCover(id: string, key: string): Promise<void> {
        const origin = this.originOf(id);
        const status = this.readingOf(id).status;
        const url = origin === undefined ? undefined : resolveArtworkUrl(origin, status?.image ?? status?.stationImage);
        if (url === undefined) return;
        await this.artwork.load(key, url);
        if (this.drawn.get(id)?.wanted === key) this.render(id);
    }

    /**
     * Redraws every key twice a second, so the bar moves between readings.
     *
     * One timer for every key of this action rather than one each, and it runs only while a key is
     * on a visible page. The painter drops a frame that is identical to the last, so a key showing
     * no bar, or a paused track, costs nothing but the comparison.
     */
    private startTicking(): void {
        if (this.ticker !== undefined) return;
        this.ticker = setInterval(() => {
            for (const [id, drawn] of this.drawn) {
                drawn.clock.tick();
                this.render(id);
            }
        }, TICK_MS);
    }

    private stopTicking(): void {
        clearInterval(this.ticker);
        this.ticker = undefined;
    }
}
