import {
    action,
    SingletonAction,
    type DidReceiveSettingsEvent,
    type KeyDownEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from '@elgato/streamdeck';

import type { PlayerSettings } from '../player.settings.js';
import type { LoveKeys } from './love.keys.js';
import type { RepeatKeys, ShuffleKeys } from './mode.keys.js';
import type { SleepKeys } from './sleep.keys.js';
import type { StopKeys } from './stop.keys.js';

/**
 * The Stream Deck's side of the one-press keys that have nothing to configure but a player: shuffle,
 * repeat, love, stop and the sleep timer. One base class, because the decorator takes a literal and so each needs
 * its own class, but what they forward is identical.
 */
abstract class PressAction extends SingletonAction<PlayerSettings> {
    constructor(protected readonly keys: ShuffleKeys | RepeatKeys | LoveKeys | StopKeys | SleepKeys) {
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

@action({ UUID: 'com.maroonedsoftware.bluos.shuffle' })
export class ShuffleAction extends PressAction {}

@action({ UUID: 'com.maroonedsoftware.bluos.repeat' })
export class RepeatAction extends PressAction {}

@action({ UUID: 'com.maroonedsoftware.bluos.love' })
export class LoveAction extends PressAction {}

@action({ UUID: 'com.maroonedsoftware.bluos.stop' })
export class StopAction extends PressAction {}

@action({ UUID: 'com.maroonedsoftware.bluos.sleep' })
export class SleepAction extends PressAction {}
