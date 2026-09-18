import {
    action,
    SingletonAction,
    type DidReceiveSettingsEvent,
    type KeyDownEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from '@elgato/streamdeck';

import type { InputKeys } from './input.keys.js';
import type { InputKeySettings } from './input.options.js';

/** The Stream Deck's side of an input key. Everything it decides is in `InputKeys`. */
@action({ UUID: 'com.maroonedsoftware.bluos.input' })
export class InputAction extends SingletonAction<InputKeySettings> {
    constructor(private readonly keys: InputKeys) {
        super();
    }

    override onWillAppear(ev: WillAppearEvent<InputKeySettings>): void {
        if (ev.action.isKey()) this.keys.appear(ev.action, ev.payload.settings);
    }

    override onWillDisappear(ev: WillDisappearEvent<InputKeySettings>): void {
        this.keys.disappear(ev.action.id);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<InputKeySettings>): void {
        this.keys.settingsChanged(ev.action.id, ev.payload.settings);
    }

    override async onKeyDown(ev: KeyDownEvent<InputKeySettings>): Promise<void> {
        await this.keys.press(ev.action.id);
    }
}
