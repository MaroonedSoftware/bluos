import {
    action,
    SingletonAction,
    type DidReceiveSettingsEvent,
    type KeyDownEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from '@elgato/streamdeck';

import type { PresetKeys } from './preset.keys.js';
import type { PresetKeySettings } from './preset.options.js';

/** The Stream Deck's side of a preset key. Everything it decides is in `PresetKeys`. */
@action({ UUID: 'com.maroonedsoftware.bluos.preset' })
export class PresetAction extends SingletonAction<PresetKeySettings> {
    constructor(private readonly keys: PresetKeys) {
        super();
    }

    override onWillAppear(ev: WillAppearEvent<PresetKeySettings>): void {
        if (ev.action.isKey()) this.keys.appear(ev.action, ev.payload.settings);
    }

    override onWillDisappear(ev: WillDisappearEvent<PresetKeySettings>): void {
        this.keys.disappear(ev.action.id);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PresetKeySettings>): void {
        this.keys.settingsChanged(ev.action.id, ev.payload.settings);
    }

    override async onKeyDown(ev: KeyDownEvent<PresetKeySettings>): Promise<void> {
        await this.keys.press(ev.action.id);
    }
}
