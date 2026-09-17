import { action, SingletonAction, type DidReceiveSettingsEvent, type WillAppearEvent, type WillDisappearEvent } from '@elgato/streamdeck';

import type { NowPlayingKeys } from './now.playing.js';
import type { NowPlayingKeySettings } from './now.playing.options.js';

/** The Stream Deck's side of Now playing. Everything it decides is in `NowPlayingKeys`. */
@action({ UUID: 'com.maroonedsoftware.bluos.now-playing' })
export class NowPlayingAction extends SingletonAction<NowPlayingKeySettings> {
    constructor(private readonly keys: NowPlayingKeys) {
        super();
    }

    override onWillAppear(ev: WillAppearEvent<NowPlayingKeySettings>): void {
        if (ev.action.isKey()) this.keys.appear(ev.action, ev.payload.settings);
    }

    override onWillDisappear(ev: WillDisappearEvent<NowPlayingKeySettings>): void {
        this.keys.disappear(ev.action.id);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<NowPlayingKeySettings>): void {
        this.keys.settingsChanged(ev.action.id, ev.payload.settings);
    }
}
