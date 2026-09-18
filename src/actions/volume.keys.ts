import type { CommandAnswer } from '../bluos/client.js';
import { classify, describe } from '../bluos/connection.failure.js';
import type { Reading } from '../bluos/status.watcher.js';
import { asKeyImage } from '../display/key.image.js';
import { volumeSvg } from '../display/volume.image.js';
import { VolumeModel } from '../volume/volume.model.js';
import { VolumeWriter } from '../volume/volume.writer.js';
import type { KeyFace } from './key.face.js';
import { KeyControls } from './key.controls.js';
import { volumeOptionsFrom, type VolumeKeySettings, type VolumeOptions } from './volume.options.js';

/** How long a key must be held before it starts repeating, and how fast it repeats after that. */
export const REPEAT_DELAY_MS = 400;
export const REPEAT_EVERY_MS = 120;

/**
 * The most steps one hold may take, whatever happens.
 *
 * NOT a nicety. `onKeyUp` can be lost: a profile change, a device disconnect, or the app restarting
 * with a finger down. Without a ceiling the repeat runs away and drives somebody's volume to 100
 * with no way to stop it, which is the worst thing in this plugin that could happen. Eighty steps
 * is about ten seconds of holding and four times the range at the default step.
 */
export const REPEAT_CEILING = 80;

interface Knob {
    options: VolumeOptions;
    model: VolumeModel;
    writer: VolumeWriter;
    repeat?: { timer: ReturnType<typeof setTimeout>; taken: number };
}

/**
 * Turning a player up and down from a key, and muting it.
 *
 * The model and the writer are the same ones the dial uses, which is the point of them being plain
 * classes with no HTTP and no SDK in them: everything hard about volume is tested once and both
 * shells stay thin.
 */
export class VolumeKeys extends KeyControls {
    private readonly volumes = new Map<string, Knob>();

    override appear(face: KeyFace, settings: VolumeKeySettings): void {
        const options = volumeOptionsFrom(settings);
        const model = new VolumeModel();
        model.cap = options.cap;
        this.volumes.set(face.id, {
            options,
            model,
            writer: new VolumeWriter(level => this.write(face.id, level)),
        });
        super.appear(face, settings);
    }

    override disappear(id: string): void {
        this.stopRepeat(id);
        this.volumes.get(id)?.writer.cancel();
        this.volumes.delete(id);
        super.disappear(id);
    }

    override settingsChanged(id: string, settings: VolumeKeySettings): void {
        const held = this.volumes.get(id);
        if (held !== undefined) {
            held.options = volumeOptionsFrom(settings);
            held.model.cap = held.options.cap;
        }
        super.settingsChanged(id, settings);
        this.render(id);
    }

    /** A press: one step at once, then a repeat if the finger stays down. */
    async down(id: string): Promise<void> {
        const held = this.volumes.get(id);
        if (held === undefined) return;
        if (!(await this.step(id))) return;
        if (held.options.direction === 'mute') return;

        // The OS keyboard's shape: a pause, then a steady repeat.
        held.repeat = {
            taken: 1,
            timer: setTimeout(() => this.keepStepping(id), REPEAT_DELAY_MS),
        };
    }

    /** The finger came off. */
    up(id: string): void {
        this.stopRepeat(id);
    }

    protected override onDisappear(id: string): void {
        // A page change during a held key never delivers `keyUp`, so this is the other way out.
        this.stopRepeat(id);
    }

    protected override onReading(id: string, reading: Reading): void {
        this.volumes.get(id)?.model.reportFromPlayer(reading.status);
    }

    protected override render(id: string): void {
        const held = this.volumes.get(id);
        if (held === undefined) return;
        const reading = this.readingOf(id);
        const { options, model } = held;

        this.paint(id, {
            image: asKeyImage(volumeSvg(options.direction, { muted: model.muted, stale: reading.stale })),
            title: this.words(reading, held),
        });
    }

    private words(reading: Reading, held: Knob): string {
        if (reading.failure !== undefined) return describe(reading.failure).title;
        if (reading.status === undefined) return '';
        if (held.model.fixed) return 'Fixed';
        if (held.model.muted) return 'Muted';
        if (!held.options.showLevel) return '';
        const level = held.model.level;
        return level === undefined ? '' : String(level);
    }

    /** One step. Returns whether it did anything, so a refused press does not start repeating. */
    private async step(id: string): Promise<boolean> {
        const held = this.volumes.get(id);
        const face = this.face(id);
        const reading = this.readingOf(id);
        if (held === undefined) return false;

        if (this.watcherOf(id) === undefined || reading.status === undefined || reading.stale) {
            this.world.log(`The volume was pressed while ${describe(reading.failure ?? 'unreachable').sentence.toLowerCase()}`);
            await face?.showAlert().catch(() => undefined);
            return false;
        }

        if (held.model.fixed) {
            this.world.log('This player has a fixed output level, so its volume cannot be set from here.');
            await face?.showAlert().catch(() => undefined);
            return false;
        }

        if (held.options.direction === 'mute') {
            const mute = held.model.toggleMute();
            this.render(id);
            const answer = await this.command(id, { mute });
            this.volumes.get(id)?.model.confirmWrite(answer?.volume, answer?.muted ?? mute === 1);
            this.render(id);
            return true;
        }

        const wanted = held.model.nudge(held.options.direction === 'up' ? held.options.step : -held.options.step);
        if (wanted === undefined) return false;
        // Drawn before it is written, so the key answers the finger rather than the network.
        this.render(id);
        held.writer.want(wanted);
        return true;
    }

    private keepStepping(id: string): void {
        const held = this.volumes.get(id);
        if (held?.repeat === undefined) return;
        if (held.repeat.taken >= REPEAT_CEILING) {
            this.world.log('The volume key stopped repeating: it reached its limit without the press ever being released.');
            this.stopRepeat(id);
            return;
        }
        held.repeat.taken += 1;
        void this.step(id).then(went => {
            // A write that failed stops the repeat rather than piling up eighty more.
            if (!went) this.stopRepeat(id);
        });
        const still = this.volumes.get(id);
        if (still?.repeat !== undefined) still.repeat.timer = setTimeout(() => this.keepStepping(id), REPEAT_EVERY_MS);
    }

    private stopRepeat(id: string): void {
        const held = this.volumes.get(id);
        if (held?.repeat === undefined) return;
        clearTimeout(held.repeat.timer);
        held.repeat = undefined;
    }

    private async write(id: string, level: number): Promise<void> {
        const answer = await this.command(id, { level });
        this.volumes.get(id)?.model.confirmWrite(answer?.volume, answer?.muted, level);
        this.render(id);
    }

    /** Sends one volume command, and says so on the key if it did not go. */
    private async command(id: string, query: Record<string, number>): Promise<CommandAnswer | undefined> {
        const watcher = this.watcherOf(id);
        if (watcher === undefined) return undefined;
        try {
            return await watcher.command((client, signal) => client.command('/Volume', query, signal));
        } catch (error) {
            this.world.log(`The volume could not be set: ${describe(classify(error)).sentence}`);
            await this.face(id)
                ?.showAlert()
                .catch(() => undefined);
            return undefined;
        }
    }
}
