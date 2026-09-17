import {
    action,
    SingletonAction,
    type DidReceiveSettingsEvent,
    type KeyDownEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from '@elgato/streamdeck';

import type { PlayerSettings } from '../player.settings.js';
import type { TransportKeys } from './transport.keys.js';

/** The Stream Deck's side of Play or pause. Everything it decides is in `TransportKeys`. */
@action({ UUID: 'com.maroonedsoftware.bluos.transport' })
export class TransportAction extends SingletonAction<PlayerSettings> {
    constructor(private readonly keys: TransportKeys) {
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

    override async onKeyDown(ev: KeyDownEvent<PlayerSettings>): Promise<void> {
        await this.keys.press(ev.action.id);
    }
}
