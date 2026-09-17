import { action, SingletonAction, type WillAppearEvent, type WillDisappearEvent } from '@elgato/streamdeck';

/**
 * The Stream Deck's side of Now playing.
 *
 * A shell for now: it records that a key exists and draws nothing, because there is no player to
 * ask yet. What it will forward to lives in `now.playing.ts` when that arrives, which is the split
 * every action in this plugin keeps — the SDK's events here, every decision somewhere testable.
 */
@action({ UUID: 'com.maroonedsoftware.bluos.now-playing' })
export class NowPlayingAction extends SingletonAction {
    private readonly keys = new Set<string>();

    /** How many keys of this action are on a visible page. Read by the tests, and by nothing else yet. */
    get showing(): number {
        return this.keys.size;
    }

    override onWillAppear(ev: WillAppearEvent): void {
        this.keys.add(ev.action.id);
    }

    override onWillDisappear(ev: WillDisappearEvent): void {
        this.keys.delete(ev.action.id);
    }
}
