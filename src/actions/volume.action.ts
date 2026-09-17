import {
    action,
    SingletonAction,
    type DidReceiveSettingsEvent,
    type KeyDownEvent,
    type KeyUpEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from '@elgato/streamdeck';

import type { VolumeKeys } from './volume.keys.js';
import type { VolumeKeySettings } from './volume.options.js';

/** The Stream Deck's side of the volume key. Everything it decides is in `VolumeKeys`. */
@action({ UUID: 'com.maroonedsoftware.bluos.volume' })
export class VolumeAction extends SingletonAction<VolumeKeySettings> {
    constructor(private readonly keys: VolumeKeys) {
        super();
    }

    override onWillAppear(ev: WillAppearEvent<VolumeKeySettings>): void {
        if (ev.action.isKey()) this.keys.appear(ev.action, ev.payload.settings);
    }

    override onWillDisappear(ev: WillDisappearEvent<VolumeKeySettings>): void {
        this.keys.disappear(ev.action.id);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<VolumeKeySettings>): void {
        this.keys.settingsChanged(ev.action.id, ev.payload.settings);
    }

    override async onKeyDown(ev: KeyDownEvent<VolumeKeySettings>): Promise<void> {
        await this.keys.down(ev.action.id);
    }

    /** The finger came off, which is what stops a held key repeating. */
    override onKeyUp(ev: KeyUpEvent<VolumeKeySettings>): void {
        this.keys.up(ev.action.id);
    }
}
