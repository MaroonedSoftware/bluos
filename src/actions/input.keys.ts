import { describe } from '../bluos/connection.failure.js';
import type { InputSource } from '../bluos/inputs.reading.js';
import { resolveArtworkUrl, type ArtworkCache } from '../display/artwork.js';
import { inputSvg } from '../display/input.image.js';
import { asKeyImage } from '../display/key.image.js';
import { refuse, runCommand } from './command.outcome.js';
import { inputFrom, type InputKeySettings } from './input.options.js';
import { KeyControls } from './key.controls.js';
import type { KeyFace } from './key.face.js';
import type { KeysWorld } from './player.keys.js';

interface Directory {
    inputs?: InputSource[];
    loading?: Promise<void>;
}

/**
 * A key that switches the player to one of its inputs: optical, HDMI, a turntable.
 *
 * It uses the specification's Active Input Selection (section 11.1): the inputs come from
 * `/RadioBrowse?service=Capture`, and each is played with `/Play?url=` and the URL it was listed
 * with. That is the one method the specification says works for a BluOS HUB's inputs too.
 *
 * The key outlines itself while its input is the one playing, which `/Status` reports as
 * `inputId`, so a row of input keys reads like the selector on the front of an amplifier.
 *
 * Inputs change rarely and `/Status` has no signal for when they do, so the list is read once per
 * player, and once more if a key asks for an input the list does not have.
 */
export class InputKeys extends KeyControls {
    private readonly directories = new Map<string, Directory>();
    private readonly choices = new Map<string, string | undefined>();

    constructor(
        world: KeysWorld,
        private readonly artwork: ArtworkCache,
    ) {
        super(world);
    }

    override appear(face: KeyFace, settings: InputKeySettings): void {
        this.choices.set(face.id, inputFrom(settings));
        super.appear(face, settings);
    }

    override settingsChanged(id: string, settings: InputKeySettings): void {
        this.choices.set(id, inputFrom(settings));
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
        const origin = this.originOf(id);
        const choice = this.choices.get(id);

        if (watcher === undefined || origin === undefined || reading.status === undefined || reading.stale) {
            await refuse(face, this.world.log, `An input was pressed while ${describe(reading.failure ?? 'unreachable').sentence.toLowerCase()}`);
            return;
        }
        if (choice === undefined) {
            await refuse(face, this.world.log, 'This key has not been given an input yet. Choose one in its settings.');
            return;
        }

        let input = this.inputOf(origin, choice);
        if (input === undefined) {
            // The list may simply be older than the input; ask once more before giving up.
            await this.load(origin, true);
            input = this.inputOf(origin, choice);
        }
        if (input === undefined) {
            await refuse(face, this.world.log, `The player has no input "${choice}". It may be hidden in the BluOS app, or disconnected.`);
            return;
        }

        const url = input.url;
        await runCommand(face, () => watcher.command((client, signal) => client.command('/Play', { url }, signal)), this.world.log);
    }

    protected override onReading(id: string): void {
        const origin = this.originOf(id);
        if (origin !== undefined && this.directories.get(origin)?.inputs === undefined) void this.load(origin, false);
    }

    protected override render(id: string): void {
        const reading = this.readingOf(id);
        const origin = this.originOf(id);
        const choice = this.choices.get(id);
        const input = origin === undefined || choice === undefined ? undefined : this.inputOf(origin, choice);

        const url = origin === undefined ? undefined : resolveArtworkUrl(origin, input?.image);
        const icon = url === undefined ? undefined : this.artwork.peek(url)?.cover;
        if (url !== undefined && this.artwork.peek(url) === undefined) void this.artwork.load(url, url).then(() => this.render(id));

        this.paint(id, {
            title: this.words(reading.failure === undefined ? undefined : describe(reading.failure).title, choice, input),
            image: asKeyImage(
                inputSvg({
                    ...(icon === undefined ? {} : { icon }),
                    active: choice !== undefined && reading.status?.inputId === choice,
                    stale: reading.stale,
                }),
            ),
        });
    }

    private words(failure: string | undefined, choice: string | undefined, input: InputSource | undefined): string {
        if (failure !== undefined) return failure;
        if (choice === undefined) return 'No input';
        return input?.name ?? 'Input';
    }

    private inputOf(origin: string, choice: string): InputSource | undefined {
        return this.directories.get(origin)?.inputs?.find(input => input.id === choice);
    }

    /** Reads one player's inputs, once at a time, and redraws every key on that player. */
    private load(origin: string, again: boolean): Promise<void> {
        const directory = this.directories.get(origin) ?? {};
        this.directories.set(origin, directory);
        if (directory.loading !== undefined) return directory.loading;
        if (directory.inputs !== undefined && !again) return Promise.resolve();

        directory.loading = this.world.pool
            .for(origin)
            .client.inputs(AbortSignal.timeout(10_000))
            .then(inputs => {
                directory.inputs = inputs;
            })
            .catch(error => {
                this.world.log(`The player's inputs could not be read: ${String(error)}`);
            })
            .finally(() => {
                directory.loading = undefined;
                for (const id of this.ids) if (this.originOf(id) === origin) this.render(id);
            });
        return directory.loading;
    }
}
