import type { Reading, StatusWatcher } from '../bluos/status.watcher.js';
import type { WatcherPool } from '../bluos/watcher.pool.js';
import { addressToAdopt, originFor, type GlobalSettings, type PlayerSettings } from '../player.settings.js';
import type { ControlFace } from './key.face.js';

/** What a key needs from the world, so a test can hand it something simpler than the SDK. */
export interface KeysWorld {
    pool: WatcherPool;
    /** The settings every key shares, read fresh because the panel can change them at any moment. */
    global: () => GlobalSettings;
    log: (sentence: string) => void;
}

interface Held<F extends ControlFace> {
    face: F;
    /** The player this key is pointed at, or `undefined` while it has none. */
    origin?: string;
    watcher?: StatusWatcher;
    release?: () => void;
    unsubscribe?: () => void;
    reading: Reading;
}

/** The reading a key has before it has heard anything: no player, and nothing known. */
const NOTHING: Reading = { failure: 'unconfigured', stale: false };

/**
 * Every key of one action, and each key's own hold on its own player.
 *
 * This is where the shape departs furthest from the sibling plugin. Its `StationKeys` acquires the
 * poller ONCE, on the first key of an action, because one API key meant one station and every key
 * necessarily watched it. Here the address is a per-key setting, so two Now Playing keys may name
 * two different players, and the hold has to be per key: its own watcher, its own subscription, its
 * own reading, and a `render` that draws one key rather than all of them.
 *
 * Six keys on one player still cost one long-poll, because the pool hands them the same watcher.
 * What changed is who holds it, not how many there are.
 */
export abstract class PlayerKeys<F extends ControlFace = ControlFace> {
    private readonly held = new Map<string, Held<F>>();

    constructor(protected readonly world: KeysWorld) {}

    /** The keys currently on a visible page. */
    protected get ids(): string[] {
        return [...this.held.keys()];
    }

    /** What this key last heard from its player. */
    protected readingOf(id: string): Reading {
        return this.held.get(id)?.reading ?? NOTHING;
    }

    /** The player this key is pointed at, or `undefined`. */
    protected originOf(id: string): string | undefined {
        return this.held.get(id)?.origin;
    }

    /** The watcher this key is watching, for a command it wants to send. */
    protected watcherOf(id: string): StatusWatcher | undefined {
        return this.held.get(id)?.watcher;
    }

    protected face(id: string): F | undefined {
        return this.held.get(id)?.face;
    }

    appear(face: F, settings: PlayerSettings): void {
        this.held.set(face.id, { face, reading: NOTHING });
        this.onAdd(face);

        // A key with no address of its own takes the last player chosen anywhere and WRITES it into
        // itself, rather than falling back quietly every time it is used. See player.settings.ts.
        // The write comes back as `didReceiveSettings`, which is what actually re-points the key;
        // pointing it here as well is what makes it draw now rather than a round trip later.
        const adopt = addressToAdopt(settings, this.world.global());
        if (adopt !== undefined) void face.setSettings({ ...settings, address: adopt }).catch(() => undefined);

        this.point(face.id, adopt === undefined ? settings : { ...settings, address: adopt });
        this.onAppear(face.id);
    }

    disappear(id: string): void {
        this.letGo(id);
        this.onRemove(id);
        this.held.delete(id);
        this.onDisappear(id);
        // A watcher whose last key has gone stops on its own after a pause, so this only clears out
        // the map. A key merely changing page is still inside that pause and keeps its player.
        this.world.pool.tidy();
    }

    /** This key's settings changed, which may mean it is pointed somewhere else now. */
    settingsChanged(id: string, settings: PlayerSettings): void {
        const held = this.held.get(id);
        if (held === undefined) return;
        const wanted = originFor(settings, this.world.global());
        if (wanted === held.origin) return;
        this.letGo(id);
        this.point(id, settings);
    }

    /** The settings every key shares changed, so any key without its own address may have moved. */
    globalSettingsChanged(settingsOf: (id: string) => PlayerSettings): void {
        for (const id of this.ids) this.settingsChanged(id, settingsOf(id));
    }

    /** Draws one key. Called on every reading it hears, and whenever the action changes something. */
    protected abstract render(id: string): void;

    /** A control appeared, after it has been pointed at its player. */
    protected onAppear(_id: string): void {}

    /** A control was added, before anything else happens, so a painter can take hold of it. */
    protected onAdd(_face: F): void {}

    /** A control is going, before its hold is let go. */
    protected onRemove(_id: string): void {}

    /** A key went, before its hold is let go. */
    protected onDisappear(_id: string): void {}

    /** A reading arrived for this key, before it is drawn. */
    protected onReading(_id: string, _reading: Reading): void {}

    /** Points one key at whatever its settings now name, and starts listening. */
    private point(id: string, settings: PlayerSettings): void {
        const held = this.held.get(id);
        if (held === undefined) return;

        const origin = originFor(settings, this.world.global());
        held.origin = origin;
        if (origin === undefined) {
            held.reading = NOTHING;
            this.onReading(id, held.reading);
            this.render(id);
            return;
        }

        const watcher = this.world.pool.for(origin);
        held.watcher = watcher;
        held.release = watcher.acquire();
        // Subscribing hands over the current reading at once, so a key never sits on the manifest's
        // own picture while the plugin already knows the answer. A second key on a player somebody
        // is already watching draws immediately rather than waiting for the next change.
        held.unsubscribe = watcher.subscribe(reading => {
            const still = this.held.get(id);
            if (still === undefined || still.watcher !== watcher) return;
            still.reading = reading;
            this.onReading(id, reading);
            this.render(id);
        });
    }

    private letGo(id: string): void {
        const held = this.held.get(id);
        if (held === undefined) return;
        held.unsubscribe?.();
        held.release?.();
        held.unsubscribe = undefined;
        held.release = undefined;
        held.watcher = undefined;
        held.origin = undefined;
    }
}
