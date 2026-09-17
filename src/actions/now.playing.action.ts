import { action, SingletonAction, type DidReceiveSettingsEvent, type WillAppearEvent, type WillDisappearEvent } from '@elgato/streamdeck';

import type { PlayerSettings } from '../player.settings.js';
import type { NowPlayingKeys } from './now.playing.js';

/** The Stream Deck's side of Now playing. Everything it decides is in `NowPlayingKeys`. */
@action({ UUID: 'com.maroonedsoftware.bluos.now-playing' })
export class NowPlayingAction extends SingletonAction<PlayerSettings> {
    constructor(private readonly keys: NowPlayingKeys) {
        super();
    }

    override onWillAppear(ev: WillAppearEvent<PlayerSettings>): void {
        if (ev.action.isKey()) this.keys.appear(ev.action, ev.payload.settings);
    }

    override onWillDisappear(ev: WillDisappearEvent<PlayerSettings>): void {
        this.keys.disappear(ev.action.id);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PlayerSettings>): void {
        this.keys.settingsChanged(ev.action.id, ev.payload.settings);
    }
}
