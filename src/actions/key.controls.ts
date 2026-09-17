import type { Frame, KeyFace } from './key.face.js';
import { FacePainter } from './key.face.js';
import { PlayerKeys } from './player.keys.js';

/**
 * Every key of one action: what `PlayerKeys` knows about players, plus a painter.
 *
 * The painter lives here rather than in `PlayerKeys` because a dial has no key face to paint. The
 * split is the same one the SDK makes: a dial has `setFeedback` where a key has `setImage` and
 * `setState`, and nothing useful is shared between them but the fact that both follow a player.
 */
export abstract class KeyControls extends PlayerKeys<KeyFace> {
    private readonly painter = new FacePainter();

    protected override onAdd(face: KeyFace): void {
        this.painter.add(face);
    }

    protected override onRemove(id: string): void {
        this.painter.remove(id);
    }

    /** Sends one key whatever in the frame has actually changed since it was last told. */
    protected paint(id: string, frame: Frame): void {
        this.painter.paint(id, frame);
    }
}
