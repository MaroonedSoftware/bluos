import {
    action,
    SingletonAction,
    type DialDownEvent,
    type DialRotateEvent,
    type DialUpEvent,
    type DidReceiveSettingsEvent,
    type TouchTapEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from '@elgato/streamdeck';

import type { PlayerSettings } from '../player.settings.js';
import type { VolumeDial } from './volume.dial.js';

/** The Stream Deck's side of the volume dial. Everything it decides is in `VolumeDial`. */
@action({ UUID: 'com.maroonedsoftware.bluos.volume-dial' })
export class VolumeDialAction extends SingletonAction<PlayerSettings> {
    constructor(private readonly dial: VolumeDial) {
        super();
    }

    override onWillAppear(ev: WillAppearEvent<PlayerSettings>): void {
        if (ev.action.isDial()) this.dial.appear(ev.action, ev.payload.settings);
    }

    override onWillDisappear(ev: WillDisappearEvent<PlayerSettings>): void {
        this.dial.disappear(ev.action.id);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PlayerSettings>): void {
        this.dial.settingsChanged(ev.action.id, ev.payload.settings);
    }

    override onDialRotate(ev: DialRotateEvent<PlayerSettings>): void {
        this.dial.rotate(ev.action.id, ev.payload.ticks, ev.payload.pressed);
    }

    override onDialDown(ev: DialDownEvent<PlayerSettings>): void {
        this.dial.down(ev.action.id);
    }

    override async onDialUp(ev: DialUpEvent<PlayerSettings>): Promise<void> {
        await this.dial.up(ev.action.id);
    }

    override async onTouchTap(ev: TouchTapEvent<PlayerSettings>): Promise<void> {
        await this.dial.tap(ev.action.id);
    }
}
