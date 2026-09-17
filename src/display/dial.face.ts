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
        { face: DialFace; sent: DialFrame; timer?: ReturnType<typeof setTimeout>; waiting?: DialFrame; lastSentAt: number }
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
    paint(id: string, frame: DialFrame): void {
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

        const changed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(frame)) {
            if (value === undefined || dial.sent[key as keyof DialFrame] === value) continue;
            changed[key] = value;
            (dial.sent as Record<string, unknown>)[key] = value;
        }
        if (Object.keys(changed).length === 0) return;

        dial.lastSentAt = this.now();
        // A send that fails does so because the app has let the dial go, and that is its own event.
        dial.face.setFeedback(changed).catch(() => undefined);
    }
}
