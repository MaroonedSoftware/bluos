import type { KeyFace } from '../../src/actions/key.face.js';

/** A Stream Deck key, faked: it records what it was told rather than drawing it. */
export class FakeKey implements KeyFace {
    readonly titles: (string | undefined)[] = [];
    readonly images: (string | undefined)[] = [];
    readonly states: number[] = [];
    oks = 0;
    alerts = 0;
    settings: Record<string, unknown> | undefined;

    constructor(readonly id: string) {}

    /** The last thing this key was told to show. */
    get title(): string | undefined {
        return this.titles.at(-1);
    }

    get image(): string | undefined {
        return this.images.at(-1);
    }

    get state(): number | undefined {
        return this.states.at(-1);
    }

    setTitle(title?: string): Promise<void> {
        this.titles.push(title);
        return Promise.resolve();
    }

    setImage(image?: string): Promise<void> {
        this.images.push(image);
        return Promise.resolve();
    }

    setState(state: number): Promise<void> {
        this.states.push(state);
        return Promise.resolve();
    }

    showOk(): Promise<void> {
        this.oks += 1;
        return Promise.resolve();
    }

    showAlert(): Promise<void> {
        this.alerts += 1;
        return Promise.resolve();
    }

    setSettings(settings: Record<string, unknown>): Promise<void> {
        this.settings = settings;
        return Promise.resolve();
    }
}
