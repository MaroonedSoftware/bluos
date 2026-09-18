import type { StatusReading } from '../bluos/status.reading.js';

/**
 * How long a level the user just asked for is protected from what the player reports.
 *
 * Long enough to cover a write, the player acting on it, and the long-poll waking with the new
 * state; short enough that somebody picking up the BluOS app or the amplifier's remote sees the key
 * follow them almost at once.
 */
export const SETTLE_MS = 800;

export interface VolumeModelOptions {
    settleMs?: number;
    now?: () => number;
}

/**
 * The volume a key or a dial is showing, which is not always the volume the player last reported.
 *
 * Without this the obvious implementation fights itself. A tick writes, the long-poll answers with
 * the pre-write value, and the dial jumps backwards under the user's fingers. So the level the user
 * asked for is held as `intended` and drawn immediately, and what the player says about the volume
 * is ignored until the asking has settled. Everything ELSE in that reading is still used: this is a
 * veto on one field, not on the reading.
 *
 * **Only user input ever creates an `intended` value.** A device report never causes a write. That
 * one rule is what stops a player which rounds to its own dB steps becoming an infinite loop: ask
 * for 43, be told 42, ask for 43 again, forever. The measured player does not round, but its volume
 * range is configurable and one set up differently could, and "keep trying until it matches" is the
 * obvious wrong fix that somebody will otherwise reach for.
 */
export class VolumeModel {
    private readonly settleMs: number;
    private readonly now: () => number;
    private intended?: number;
    private confirmed?: number;
    private settledUntil = 0;
    private lastInputAt = 0;

    muted = false;
    /** The player has a fixed output level, reported as a volume of -1. Nothing can be set. */
    fixed = false;
    /**
     * The loudest this control will ask for, out of 100.
     *
     * A safety limit rather than a preference. On an amplifier, one fast turn of a dial or a held key
     * can take a room somewhere nobody wanted it, and the repeat ceiling only limits how LONG a key
     * runs, not how loud it gets. It limits only what this control asks for. A level somebody set from
     * the BluOS app is left alone, and pressing "up" above the cap does nothing rather than dropping
     * the room to the cap, because "up" must never make things quieter.
     */
    cap = 100;

    constructor(options: VolumeModelOptions = {}) {
        this.settleMs = options.settleMs ?? SETTLE_MS;
        this.now = options.now ?? (() => Date.now());
    }

    /** What to draw: what was asked for if it is still unsettled, otherwise what the player said. */
    get level(): number | undefined {
        return this.intended ?? this.confirmed;
    }

    /** Whether a level the user asked for is still waiting to be confirmed. */
    get pending(): boolean {
        return this.intended !== undefined;
    }

    /**
     * Moves the level by `delta` and returns what to write, or `undefined` when there is nothing to
     * write: a fixed output, or a player whose level is not known yet so there is nothing to move.
     */
    nudge(delta: number): number | undefined {
        if (this.fixed) return undefined;
        const from = this.level;
        if (from === undefined) return undefined;
        if (delta > 0) {
            // Up stops at the cap, or wherever the level already is if something else put it higher.
            const ceiling = Math.max(from, this.cap);
            const target = Math.min(from + delta, ceiling);
            return target === from ? undefined : this.setTo(target, ceiling);
        }
        // Down is a step down from wherever the level is. Clamped to the cap instead, one press from
        // 70 with a cap of 40 would drop the room to 40 in a single step, which a test caught.
        return this.setTo(from + delta, Math.max(from, this.cap));
    }

    /** Sets the level outright and returns what to write. Never above the cap unless told otherwise. */
    setTo(level: number, ceiling: number = this.cap): number | undefined {
        if (this.fixed) return undefined;
        const wanted = Math.min(100, ceiling, Math.max(0, Math.round(level)));
        this.intended = wanted;
        this.asked();
        return wanted;
    }

    /** What to send to mute or unmute, following the player's examples rather than its wrong table. */
    toggleMute(): 0 | 1 {
        this.muted = !this.muted;
        this.asked();
        return this.muted ? 1 : 0;
    }

    /**
     * A write landed, carrying whatever level the player settled on.
     *
     * The player's number is the truth, even when it is not the number that was asked for: a volume
     * range configured in the BluOS app can round a level, and chasing it would be an infinite write
     * loop against somebody's stereo. So `wrote` says which ask this answers, and the asking is only
     * cleared when nothing has moved since. A user who kept turning while the write was out keeps
     * what they turned to.
     */
    confirmWrite(level: number | undefined, muted?: boolean, wrote?: number): void {
        if (muted !== undefined) this.muted = muted;
        if (level === undefined) return;
        this.confirmed = level;
        if (wrote === undefined || this.intended === wrote) this.intended = undefined;
        this.settledUntil = Math.max(this.settledUntil, this.now() + this.settleMs, this.lastInputAt + this.settleMs);
    }

    /**
     * Somebody moved the control.
     *
     * The window starts HERE rather than when a write is confirmed, and that is the fix for the
     * rubber band rather than a refinement of it. A long-poll can answer with the pre-write level
     * before the write has even gone out, and a window that only began on confirmation would let
     * that answer overwrite what the user just asked for, which is the exact jolt this class exists
     * to prevent.
     */
    private asked(): void {
        this.lastInputAt = this.now();
        this.settledUntil = Math.max(this.settledUntil, this.lastInputAt + this.settleMs);
    }

    /**
     * A reading arrived from the player.
     *
     * The volume in it is ignored while the asking is unsettled, unless it happens to agree, in
     * which case the asking is over and an external change a moment later will be honoured rather
     * than sat on for the rest of the window.
     */
    reportFromPlayer(status: StatusReading | undefined): void {
        if (status === undefined) return;
        this.fixed = status.fixedVolume;
        const reported = status.volume;

        if (this.now() < this.settledUntil) {
            if (reported !== undefined && reported === this.intended) {
                this.confirmed = reported;
                this.intended = undefined;
            }
            return;
        }

        this.muted = status.muted;
        if (reported === undefined) return;
        this.confirmed = reported;
        // Past the window, the player is simply right: this is how the key follows the BluOS app,
        // the amplifier's own remote, or somebody else in the house.
        this.intended = undefined;
    }
}
