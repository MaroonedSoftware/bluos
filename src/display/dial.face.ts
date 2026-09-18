/** What the dial's layout can be told, keyed as `layouts/volume.json` names its items. */
export interface DialFrame {
    title?: string;
    value?: string;
    indicator?: number;
    icon?: string;
}

/** The part of a Stream Deck dial the actions use. A test's fake is one too. */
export interface DialFace {
    readonly id: string;
    setFeedback(feedback: Record<string, unknown>): Promise<void>;
    setSettings(settings: Record<string, unknown>): Promise<void>;
    showAlert(): Promise<void>;
    /**
     * What the Stream Deck app says each gesture does, where it lists them for a dial.
     *
     * The manifest gives the defaults. A dial whose press has been set to play and pause changes
     * them, because a label saying "Mute" on a knob that pauses is worse than no label.
     */
    setTriggerDescription(descriptions?: { rotate?: string; push?: string; touch?: string; longTouch?: string }): Promise<void>;
}

/** The least time between two payloads sent to one dial. */
export const THROTTLE_MS = 50;

/**
 * The dials an action is showing on, and what each was last told.
 *
 * Two things stand between a spun encoder and Elgato's ten-updates-a-second guideline, and both are
 * needed. Diffing, because `setFeedback` MERGES, so a payload carrying only what moved is both
 * correct and much smaller than a whole one. And a throttle, because diffing alone does not help
 * during a spin: every field genuinely changes on every tick.
 *
 * The throttle keeps a trailing send, so the last thing the user did always arrives. A dial that
 * stopped one frame short of where the knob was left would be worse than one that lags.
 */
export class DialPainter {
    private readonly dials = new Map<
        string,
        { face: DialFace; sent: Record<string, string>; timer?: ReturnType<typeof setTimeout>; waiting?: Record<string, unknown>; lastSentAt: number }
    >();

    constructor(private readonly now: () => number = () => Date.now()) {}

    add(face: DialFace): void {
        this.dials.set(face.id, { face, sent: {}, lastSentAt: 0 });
    }

    remove(id: string): void {
        const dial = this.dials.get(id);
        if (dial === undefined) return;
        clearTimeout(dial.timer);
        this.dials.delete(id);
    }

    get(id: string): DialFace | undefined {
        return this.dials.get(id)?.face;
    }

    /** Tells one dial whatever in the frame has actually changed, no faster than the throttle allows. */
    paint(id: string, frame: DialFrame | Record<string, unknown>): void {
        const dial = this.dials.get(id);
        if (dial === undefined) return;

        const wait = dial.lastSentAt + THROTTLE_MS - this.now();
        if (wait > 0) {
            dial.waiting = { ...dial.waiting, ...frame };
            if (dial.timer === undefined) {
                dial.timer = setTimeout(() => {
                    dial.timer = undefined;
                    const queued = dial.waiting;
                    dial.waiting = undefined;
                    if (queued !== undefined) this.paint(id, queued);
                }, wait);
            }
            return;
        }

        // Compared by their JSON, because a value can be an object that also switches an item on or off,
        // and two equal objects are never the same object.
        const changed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(frame)) {
            if (value === undefined) continue;
            const seen = JSON.stringify(value);
            if (dial.sent[key] === seen) continue;
            changed[key] = value;
            dial.sent[key] = seen;
        }
        if (Object.keys(changed).length === 0) return;

        dial.lastSentAt = this.now();
        // A send that fails does so because the app has let the dial go, and that is its own event.
        dial.face.setFeedback(changed).catch(() => undefined);
    }
}
