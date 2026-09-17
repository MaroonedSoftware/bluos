import {
    action,
    SingletonAction,
    type DidReceiveSettingsEvent,
    type KeyDownEvent,
    type WillAppearEvent,
    type WillDisappearEvent,
} from '@elgato/streamdeck';

import type { PlayerSettings } from '../player.settings.js';
import type { SkipKeys } from './skip.keys.js';

/**
 * The Stream Deck's side of a key that moves through the queue.
 *
 * Two actions rather than one with a direction setting, because the icon and the name then say
 * which way it goes and nobody can configure a Next key that goes back. The two shells are
 * identical apart from their UUID, which is why they share a base class: the decorator takes a
 * literal, so each one has to be its own class.
 */
abstract class SkipAction extends SingletonAction<PlayerSettings> {
    constructor(protected readonly keys: SkipKeys) {
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

@action({ UUID: 'com.maroonedsoftware.bluos.next' })
export class NextAction extends SkipAction {}

@action({ UUID: 'com.maroonedsoftware.bluos.previous' })
export class PreviousAction extends SkipAction {}
