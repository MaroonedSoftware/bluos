import { describe } from '../bluos/connection.failure.js';
import type { Preset, PresetList } from '../bluos/presets.reading.js';
import type { Reading } from '../bluos/status.watcher.js';
import { resolveArtworkUrl, type ArtworkCache } from '../display/artwork.js';
import { asKeyImage, nowPlayingSvg } from '../display/key.image.js';
import { refuse, runCommand } from './command.outcome.js';
import { KeyControls } from './key.controls.js';
import type { KeyFace } from './key.face.js';
import type { KeysWorld } from './player.keys.js';
import { presetFrom, presetParameter, type PresetChoice, type PresetKeySettings } from './preset.options.js';

/** One player's presets, as last read, and whether a read is under way. */
interface Directory {
    list?: PresetList;
    loading?: Promise<void>;
}

/**
 * A key that plays one of the player's presets.
 *
 * It draws the preset's own name and artwork, which is the point of it over a key that merely says
 * "Preset 3": the v1.7 specification added `image` to each preset for exactly this.
 *
 * The list is read once per player and read again only when `/Status` says it moved. `<prid>` in
 * `/Status` matches `prid` on `/Presets` and changes whenever the presets do, so the long-poll every
 * key already has says when a preset was renamed or deleted, and nothing here needs a timer.
 */
export class PresetKeys extends KeyControls {
    private readonly directories = new Map<string, Directory>();
    private readonly choices = new Map<string, PresetChoice | undefined>();

    constructor(
        world: KeysWorld,
        private readonly artwork: ArtworkCache,
    ) {
        super(world);
    }

    override appear(face: KeyFace, settings: PresetKeySettings): void {
        this.choices.set(face.id, presetFrom(settings));
        super.appear(face, settings);
    }

    override settingsChanged(id: string, settings: PresetKeySettings): void {
        this.choices.set(id, presetFrom(settings));
        super.settingsChanged(id, settings);
        this.render(id);
    }

    override disappear(id: string): void {
        this.choices.delete(id);
        super.disappear(id);
    }

    async press(id: string): Promise<void> {
        const face = this.face(id);
        const reading = this.readingOf(id);
        const watcher = this.watcherOf(id);
        const choice = this.choices.get(id);

        if (watcher === undefined || reading.status === undefined || reading.stale) {
            await refuse(face, this.world.log, `A preset was pressed while ${describe(reading.failure ?? 'unreachable').sentence.toLowerCase()}`);
            return;
        }
        if (choice === undefined) {
            await refuse(face, this.world.log, 'This key has not been given a preset yet. Choose one in its settings.');
            return;
        }
        // Only refuse a preset the list says is gone. Before the list has arrived, the player is the
        // better judge, and it answers an unknown id with an error the key reports anyway.
        const list = this.listFor(id);
        if (typeof choice === 'number' && list !== undefined && !list.presets.some(preset => preset.id === choice)) {
            await refuse(face, this.world.log, `The player has no preset ${choice} any more. It may have been deleted in the BluOS app.`);
            return;
        }

        await runCommand(
            face,
            () => watcher.command((client, signal) => client.command('/Preset', { id: presetParameter(choice) }, signal)),
            this.world.log,
        );
    }

    protected override onReading(id: string, reading: Reading): void {
        const origin = this.originOf(id);
        if (origin === undefined || reading.status === undefined) return;
        const directory = this.directories.get(origin);
        // Read the list the first time, and again whenever the player says it moved.
        if (directory?.list !== undefined && directory.list.prid === reading.status.prid) return;
        void this.load(origin);
    }

    protected override render(id: string): void {
        const reading = this.readingOf(id);
        const choice = this.choices.get(id);
        const preset = this.presetOf(id, choice);
        const origin = this.originOf(id);

        const url = origin === undefined ? undefined : resolveArtworkUrl(origin, preset?.image);
        const cover = url === undefined ? undefined : this.artwork.peek(url)?.cover;
        if (url !== undefined && this.artwork.peek(url) === undefined) {
            void this.artwork.load(url, url).then(() => this.render(id));
        }

        this.paint(id, {
            title: this.words(id, reading, choice, preset),
            image: asKeyImage(nowPlayingSvg({ ...(cover === undefined ? {} : { cover }), stale: reading.stale, shade: true })),
        });
    }

    private words(id: string, reading: Reading, choice: PresetChoice | undefined, preset: Preset | undefined): string {
        if (reading.failure !== undefined) return describe(reading.failure).title;
        if (choice === undefined) return 'No preset';
        if (choice === 'next') return 'Next preset';
        if (choice === 'previous') return 'Previous preset';
        if (preset !== undefined) return preset.name;
        // Known to be missing only once the list has arrived; before that, the number is all there is.
        return this.listFor(id) === undefined ? `Preset ${choice}` : `No preset ${choice}`;
    }

    private presetOf(id: string, choice: PresetChoice | undefined): Preset | undefined {
        if (typeof choice !== 'number') return undefined;
        return this.listFor(id)?.presets.find(preset => preset.id === choice);
    }

    private listFor(id: string): PresetList | undefined {
        const origin = this.originOf(id);
        return origin === undefined ? undefined : this.directories.get(origin)?.list;
    }

    /** Reads one player's presets, once at a time, and redraws every key on that player. */
    private load(origin: string): Promise<void> {
        const directory = this.directories.get(origin) ?? {};
        this.directories.set(origin, directory);
        if (directory.loading !== undefined) return directory.loading;

        const watcher = this.world.pool.for(origin);
        directory.loading = watcher.client
            .presets(AbortSignal.timeout(10_000))
            .then(list => {
                directory.list = list;
            })
            .catch(error => {
                this.world.log(`The player's presets could not be read: ${String(error)}`);
            })
            .finally(() => {
                directory.loading = undefined;
                for (const id of this.ids) if (this.originOf(id) === origin) this.render(id);
            });
        return directory.loading;
    }
}
