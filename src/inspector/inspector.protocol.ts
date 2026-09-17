import type { NowPlayingSettings } from '../actions/now.playing.options.js';
import type { GlobalSettings, PlayerSettings } from '../player.settings.js';
import type { ToPlugin } from './inspector.messages.js';

/**
 * What the settings panel sends the Stream Deck app, for the panel with this id opened on this
 * action.
 *
 * The app's property-inspector protocol, written by hand. Elgato suggests `sdpi-components` for
 * this, and the sibling plugin's reasons for not taking it hold here too: the npm package of that
 * name is not its author's, the protocol is six messages, and a TypeScript panel shares the address
 * parser and the message types with the plugin that answers it.
 */
export function inspectorMessages(uuid: string, action: string) {
    return {
        register: (event: string) => ({ event, uuid }),
        getSettings: () => ({ event: 'getSettings', context: uuid }),
        getGlobalSettings: () => ({ event: 'getGlobalSettings', context: uuid }),
        /** This key's own player, and whatever else this key alone decides. */
        setSettings: (settings: PlayerSettings & NowPlayingSettings) => ({ event: 'setSettings', context: uuid, payload: settings }),
        /** The player the next freshly dragged key will start on. */
        setGlobalSettings: (settings: GlobalSettings) => ({ event: 'setGlobalSettings', context: uuid, payload: settings }),
        testConnection: () => ({ event: 'sendToPlugin', action, context: uuid, payload: { event: 'testConnection' } satisfies ToPlugin }),
    };
}

/** The settings as typed: trimmed, and absent rather than empty. */
export function settingsFrom(address: string): PlayerSettings {
    const typed = address.trim();
    return typed === '' ? {} : { address: typed };
}
