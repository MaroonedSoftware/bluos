/**
 * Whether a dial's release should do anything.
 *
 * A press-and-turn delivers `dialDown`, then rotations, then `dialUp`. Muting on `dialUp` would
 * therefore mute the player every single time somebody pressed the knob and turned it, which is
 * exactly what the press-to-go-faster gesture is. So a rotate between down and up cancels the
 * release.
 *
 * Its own file with its own test because it is small, pure, and the kind of thing that is silently
 * wrong for weeks. It is this plugin's equivalent of the sibling's `arming.ts`.
 */
export class PressWatch {
    private down = false;
    private turned = false;

    press(): void {
        this.down = true;
        this.turned = false;
    }

    /** A rotation happened. Returns whether the knob is currently held, which means a coarse step. */
    rotate(): boolean {
        if (this.down) this.turned = true;
        return this.down;
    }

    /** The knob came up. Returns whether that should count as a press rather than the end of a drag. */
    release(): boolean {
        const counts = this.down && !this.turned;
        this.down = false;
        this.turned = false;
        return counts;
    }
}
