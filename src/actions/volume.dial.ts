import type { CommandAnswer } from '../bluos/client.js';
import { classify, describe } from '../bluos/connection.failure.js';
import type { Reading } from '../bluos/status.watcher.js';
import { coverKey, resolveArtworkUrl, type ArtworkCache } from '../display/artwork.js';
import { DialPainter, type DialFace } from '../display/dial.face.js';
import { VolumeModel } from '../volume/volume.model.js';
import { VolumeWriter } from '../volume/volume.writer.js';
import { PressWatch } from './dial.arming.js';
import { PlayerKeys } from './player.keys.js';

/** How much one detent moves the level, and how much more a press-and-turn moves it. */
export const DIAL_STEP = 2;
export const COARSE = 5;

/**
 * The volume on a Stream Deck + knob, with the player on the touch strip.
 *
 * It shares the model and the writer with the volume KEY, which is the whole point of those being
 * plain classes with no HTTP and no SDK in them: the coalescing, the settle window and the rule
 * against chasing a rounded level are written and tested once, and both shells stay thin.
 *
 * The strip's icon is the cover as the artwork cache already produces it, a raster data URI, rather
 * than the composed SVG a key draws. The sibling plugin measured that the app's Qt renderer draws an
 * embedded raster through `xlink:href` in `setImage` ON A KEY; nobody has measured it in a layout
 * `pixmap`, so nothing here depends on it and the composite is an upgrade if that measurement ever
 * comes back well.
 */
export class VolumeDial extends PlayerKeys<DialFace> {
    private readonly painter = new DialPainter();
    private readonly knobs = new Map<string, { model: VolumeModel; writer: VolumeWriter; press: PressWatch; wanted?: string }>();

    constructor(
        world: ConstructorParameters<typeof PlayerKeys>[0],
        private readonly artwork: ArtworkCache,
    ) {
        super(world);
    }

    protected override onAdd(face: DialFace): void {
        this.painter.add(face);
        this.knobs.set(face.id, {
            model: new VolumeModel(),
            writer: new VolumeWriter(level => this.write(face.id, level)),
            press: new PressWatch(),
        });
    }

    protected override onRemove(id: string): void {
        this.knobs.get(id)?.writer.cancel();
        this.knobs.delete(id);
        this.painter.remove(id);
    }

    /** The knob turned. Drawn at once, with no request, so it feels like hardware. */
    rotate(id: string, ticks: number, pressed: boolean): void {
        const knob = this.knobs.get(id);
        if (knob === undefined) return;
        const held = knob.press.rotate() || pressed;

        if (knob.model.fixed || this.readingOf(id).status === undefined) {
            void this.face(id)
                ?.showAlert()
                .catch(() => undefined);
            return;
        }

        const wanted = knob.model.nudge(ticks * (held ? COARSE : DIAL_STEP));
        if (wanted === undefined) return;
        this.render(id);
        knob.writer.want(wanted);
    }

    down(id: string): void {
        this.knobs.get(id)?.press.press();
    }

    /** The knob came up. A press mutes; the end of a press-and-turn does not. */
    async up(id: string): Promise<void> {
        const knob = this.knobs.get(id);
        if (knob === undefined || !knob.press.release()) return;
        await this.mute(id);
    }

    /** A tap on the touch strip plays or pauses, because mute is already on the knob. */
    async tap(id: string): Promise<void> {
        const reading = this.readingOf(id);
        const watcher = this.watcherOf(id);
        if (watcher === undefined || reading.status === undefined || reading.stale) {
            await this.face(id)
                ?.showAlert()
                .catch(() => undefined);
            return;
        }
        await this.send(id, reading.status.playing ? '/Pause' : '/Play', {});
    }

    protected override onReading(id: string, reading: Reading): void {
        this.knobs.get(id)?.model.reportFromPlayer(reading.status);
    }

    protected override render(id: string): void {
        const knob = this.knobs.get(id);
        if (knob === undefined) return;
        const reading = this.readingOf(id);
        const { model } = knob;

        const key = this.coverWanted(id);
        knob.wanted = key;
        const cover = key === undefined ? undefined : this.artwork.peek(key)?.cover;
        if (key !== undefined && this.artwork.peek(key) === undefined) void this.fetchCover(id, key);

        this.painter.paint(id, {
            title: this.title(reading),
            value: this.value(reading, model),
            indicator: model.fixed || model.muted ? 0 : (model.level ?? 0),
            ...(cover === undefined ? {} : { icon: cover }),
        });
    }

    /** The player's name, or the track, or why neither is known. */
    private title(reading: Reading): string {
        if (reading.failure !== undefined) return describe(reading.failure).title;
        return reading.status?.firstLine ?? reading.sync?.name ?? '';
    }

    private value(reading: Reading, model: VolumeModel): string {
        if (reading.failure !== undefined) return '—';
        if (model.fixed) return 'Fixed';
        if (model.muted) return 'Muted';
        const level = model.level;
        return level === undefined ? '—' : String(level);
    }

    private coverWanted(id: string): string | undefined {
        const origin = this.originOf(id);
        const status = this.readingOf(id).status;
        if (origin === undefined || status === undefined) return undefined;
        return coverKey(origin, status);
    }

    private async fetchCover(id: string, key: string): Promise<void> {
        const origin = this.originOf(id);
        const status = this.readingOf(id).status;
        const url = origin === undefined ? undefined : resolveArtworkUrl(origin, status?.image ?? status?.stationImage);
        if (url === undefined) return;
        await this.artwork.load(key, url);
        if (this.knobs.get(id)?.wanted === key) this.render(id);
    }

    private async mute(id: string): Promise<void> {
        const knob = this.knobs.get(id);
        const reading = this.readingOf(id);
        if (knob === undefined) return;
        if (this.watcherOf(id) === undefined || reading.status === undefined || reading.stale || knob.model.fixed) {
            await this.face(id)
                ?.showAlert()
                .catch(() => undefined);
            return;
        }
        const mute = knob.model.toggleMute();
        this.render(id);
        const answer = await this.send(id, '/Volume', { mute });
        knob.model.confirmWrite(answer?.volume, answer?.muted ?? mute === 1);
        this.render(id);
    }

    private async write(id: string, level: number): Promise<void> {
        const answer = await this.send(id, '/Volume', { level });
        this.knobs.get(id)?.model.confirmWrite(answer?.volume, answer?.muted, level);
        this.render(id);
    }

    private async send(id: string, path: string, query: Record<string, number>): Promise<CommandAnswer | undefined> {
        const watcher = this.watcherOf(id);
        if (watcher === undefined) return undefined;
        try {
            return await watcher.command((client, signal) => client.command(path, query, signal));
        } catch (error) {
            this.world.log(`The dial could not reach the player: ${describe(classify(error)).sentence}`);
            await this.face(id)
                ?.showAlert()
                .catch(() => undefined);
            return undefined;
        }
    }
}
