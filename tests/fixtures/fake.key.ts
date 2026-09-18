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

/** A Stream Deck dial, faked: it records the feedback it was told rather than drawing it. */
export class FakeDial {
    /** Every payload this dial was sent, in order, exactly as it was sent. */
    readonly feedback: Record<string, unknown>[] = [];
    alerts = 0;
    settings: Record<string, unknown> | undefined;

    constructor(readonly id: string) {}

    /** Everything the dial has been told, merged, which is what the app shows. */
    get shown(): Record<string, unknown> {
        return this.feedback.reduce((all, one) => ({ ...all, ...one }), {});
    }

    setFeedback(payload: Record<string, unknown>): Promise<void> {
        this.feedback.push(payload);
        return Promise.resolve();
    }

    setSettings(settings: Record<string, unknown>): Promise<void> {
        this.settings = settings;
        return Promise.resolve();
    }

    showAlert(): Promise<void> {
        this.alerts += 1;
        return Promise.resolve();
    }

    /** What the app would list for each gesture. `undefined` is the manifest's own words. */
    triggers: { rotate?: string; push?: string; touch?: string } | undefined;

    setTriggerDescription(descriptions?: { rotate?: string; push?: string; touch?: string }): Promise<void> {
        this.triggers = descriptions;
        return Promise.resolve();
    }
}

/** A dial that knows which column it is in, as a panel's quarters do. */
export class FakeStripDial extends FakeDial {
    constructor(
        id: string,
        readonly coordinates: { column: number; row: number },
    ) {
        super(id);
    }
}
