import {
    action,
    SingletonAction,
    type DialRotateEvent,
    type DialUpEvent,
    type DidReceiveSettingsEvent,
    type TouchTapEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from '@elgato/streamdeck';

import type { PlayerSettings } from '../player.settings.js';
import type { StripDial } from './strip.dial.js';

/** The Stream Deck's side of the now-playing panel. Everything it decides is in `StripDial`. */
@action({ UUID: 'com.maroonedsoftware.bluos.strip' })
export class StripDialAction extends SingletonAction<PlayerSettings> {
    constructor(private readonly strip: StripDial) {
        super();
    }

    override onWillAppear(ev: WillAppearEvent<PlayerSettings>): void {
        if (ev.action.isDial()) this.strip.appear(ev.action, ev.payload.settings);
    }

    override onWillDisappear(ev: WillDisappearEvent<PlayerSettings>): void {
        this.strip.disappear(ev.action.id);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PlayerSettings>): void {
        this.strip.settingsChanged(ev.action.id, ev.payload.settings);
    }

    override async onDialRotate(ev: DialRotateEvent<PlayerSettings>): Promise<void> {
        await this.strip.rotate(ev.action.id, ev.payload.ticks);
    }

    override async onDialUp(ev: DialUpEvent<PlayerSettings>): Promise<void> {
        await this.strip.playPause(ev.action.id);
    }

    override async onTouchTap(ev: TouchTapEvent<PlayerSettings>): Promise<void> {
        await this.strip.playPause(ev.action.id);
    }
}
