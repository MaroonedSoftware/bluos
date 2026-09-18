import type { CommandAnswer } from '../bluos/client.js';
import { classify, describe } from '../bluos/connection.failure.js';
import type { StatusReading } from '../bluos/status.reading.js';
import type { Reading } from '../bluos/status.watcher.js';
import { coverKey, resolveArtworkUrl, type ArtworkCache } from '../display/artwork.js';
import { DialPainter, type DialFace } from '../display/dial.face.js';
import { PlayheadClock, projectPlayhead, TICK_MS } from '../display/playhead.js';
import { stripSlice, type StripView } from '../display/strip.face.js';
import type { KeysWorld } from './player.keys.js';
import { PlayerKeys } from './player.keys.js';
import { skipTarget } from './skip.keys.js';

/** A dial that knows where it sits, which is what decides its quarter of the panel. */
export interface StripFace extends DialFace {
    readonly coordinates?: { readonly column: number; readonly row: number };
}

/**
 * How long after a skip the dial ignores more turning.
 *
 * A dial is easy to brush, and one detent is one track, so without this a knocked knob could run
 * through half an album. It is long enough to swallow the rest of one accidental turn and short
 * enough that a deliberate second turn still lands.
 */
export const SKIP_GUARD_MS = 700;

/**
 * A now-playing panel across the whole Stream Deck + touch strip, one dial's quarter at a time.
 *
 * Each dial the action is placed on draws the quarter its column says: the cover, then what is
 * playing, then the player and what it is doing, then the time, with one progress bar running along
 * the bottom of all four. Nothing coordinates the four; they read the same player and cut the same
 * view, so they agree.
 *
 * It is built only from what is known to draw on a Stream Deck +. The cover goes in a layout
 * `pixmap` as the raw raster the cover cache produces, which was measured on the device; the
 * composed SVG a key draws has never been tried in a pixmap and is not used here. The rest is the
 * layout's own text and bar items.
 *
 * Turning skips tracks, which is what a dial on a now-playing panel is for, and pressing or tapping
 * plays or pauses. The volume stays on the volume dial.
 */
export class StripDial extends PlayerKeys<StripFace> {
    private readonly painter = new DialPainter();
    private readonly dials = new Map<string, { clock: PlayheadClock; column: number; wanted?: string; lastSkipAt: number }>();
    private ticker?: ReturnType<typeof setInterval>;

    constructor(
        world: KeysWorld,
        private readonly artwork: ArtworkCache,
        private readonly now: () => number = () => Date.now(),
    ) {
        super(world);
    }

    protected override onAdd(face: StripFace): void {
        this.painter.add(face);
        this.dials.set(face.id, { clock: new PlayheadClock(), column: face.coordinates?.column ?? 0, lastSkipAt: -Infinity });
        this.startTicking();
    }

    protected override onRemove(id: string): void {
        this.painter.remove(id);
        this.dials.delete(id);
        if (this.dials.size === 0) this.stopTicking();
    }

    /** The knob turned: one track per turn, with a guard against a brushed knob. */
    async rotate(id: string, ticks: number): Promise<void> {
        const dial = this.dials.get(id);
        const reading = this.readingOf(id);
        const status = reading.status;
        if (dial === undefined || ticks === 0) return;
        if (this.now() - dial.lastSkipAt < SKIP_GUARD_MS) return;
        if (status === undefined || reading.stale) {
            await this.face(id)
                ?.showAlert()
                .catch(() => undefined);
            return;
        }
        const target = skipTarget(status, ticks > 0 ? 'next' : 'previous');
        if (target === undefined) {
            this.world.log(`There is no ${ticks > 0 ? 'next' : 'previous'} track: this station does not offer one.`);
            await this.face(id)
                ?.showAlert()
                .catch(() => undefined);
            return;
        }
        dial.lastSkipAt = this.now();
        await this.send(id, target, {});
    }

    /** A press, or a tap on the strip: play or pause. */
    async playPause(id: string): Promise<void> {
        const reading = this.readingOf(id);
        if (reading.status === undefined || reading.stale) {
            await this.face(id)
                ?.showAlert()
                .catch(() => undefined);
            return;
        }
        await this.send(id, reading.status.playing ? '/Pause' : '/Play', {});
    }

    protected override render(id: string): void {
        const dial = this.dials.get(id);
        if (dial === undefined) return;
        const reading = this.readingOf(id);
        const view = this.view(id, reading, dial.clock);
        this.painter.paint(id, stripSlice(dial.column, view) as Record<string, unknown>);
    }

    private view(id: string, reading: Reading, clock: PlayheadClock): StripView {
        const status = reading.status;
        const player = reading.sync?.name;
        if (reading.failure !== undefined && status === undefined) return { failure: describe(reading.failure).title, live: false };

        const key = this.coverWanted(id, status);
        const dial = this.dials.get(id);
        if (dial !== undefined) dial.wanted = key;
        const cover = key === undefined ? undefined : this.artwork.peek(key)?.cover;
        if (key !== undefined && this.artwork.peek(key) === undefined) void this.fetchCover(id, key, status);

        const playhead = projectPlayhead(status, clock.carriedFor(status));
        return {
            ...(cover === undefined ? {} : { cover }),
            ...(status?.firstLine === undefined ? {} : { firstLine: status.firstLine }),
            ...(status?.secondLine === undefined ? {} : { secondLine: status.secondLine }),
            ...(player === undefined ? {} : { player }),
            doing: reading.stale ? 'Not answering' : doing(status),
            ...(playhead === undefined ? {} : { playhead }),
            live: status !== undefined && !status.queued,
        };
    }

    private coverWanted(id: string, status: StatusReading | undefined): string | undefined {
        const origin = this.originOf(id);
        return origin === undefined || status === undefined ? undefined : coverKey(origin, status);
    }

    private async fetchCover(id: string, key: string, status: StatusReading | undefined): Promise<void> {
        const origin = this.originOf(id);
        const url = origin === undefined ? undefined : resolveArtworkUrl(origin, status?.image ?? status?.stationImage);
        if (url === undefined) return;
        await this.artwork.load(key, url);
        // Every quarter on this player wants the same cover, but only the first draws it.
        for (const other of this.ids) if (this.dials.get(other)?.wanted === key) this.render(other);
    }

    private async send(id: string, path: string, query: Record<string, number>): Promise<CommandAnswer | undefined> {
        const watcher = this.watcherOf(id);
        if (watcher === undefined) return undefined;
        try {
            return await watcher.command((client, signal) => client.command(path, query, signal));
        } catch (error) {
            this.world.log(`The panel could not reach the player: ${describe(classify(error)).sentence}`);
            await this.face(id)
                ?.showAlert()
                .catch(() => undefined);
            return undefined;
        }
    }

    /** Moves the bar and the clock between readings, because `secs` never wakes a long-poll. */
    private startTicking(): void {
        if (this.ticker !== undefined) return;
        this.ticker = setInterval(() => {
            for (const [id, dial] of this.dials) {
                dial.clock.tick();
                this.render(id);
            }
        }, TICK_MS);
    }

    private stopTicking(): void {
        clearInterval(this.ticker);
        this.ticker = undefined;
    }
}

/** What the player is doing, in a word. */
function doing(status: StatusReading | undefined): string {
    if (status === undefined) return '';
    if (status.playing) return status.queued ? 'Playing' : (status.service ?? 'Streaming');
    if (status.state === 'pause') return 'Paused';
    if (status.state === 'stop') return 'Stopped';
    return status.state ?? '';
}
