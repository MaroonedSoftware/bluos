import type { NowPlayingSettings } from '../actions/now.playing.options.js';
import type { PresetSettings } from '../actions/preset.options.js';
import type { DialSettings, VolumeSettings } from '../actions/volume.options.js';
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
        setSettings: (settings: PlayerSettings & NowPlayingSettings & VolumeSettings & DialSettings & PresetSettings) => ({
            event: 'setSettings',
            context: uuid,
            payload: settings,
        }),
        /** The player the next freshly dragged key will start on. */
        setGlobalSettings: (settings: GlobalSettings) => ({ event: 'setGlobalSettings', context: uuid, payload: settings }),
        testConnection: () => ({ event: 'sendToPlugin', action, context: uuid, payload: { event: 'testConnection' } satisfies ToPlugin }),
        discover: () => ({ event: 'sendToPlugin', action, context: uuid, payload: { event: 'discover' } satisfies ToPlugin }),
        listPresets: () => ({ event: 'sendToPlugin', action, context: uuid, payload: { event: 'presets' } satisfies ToPlugin }),
    };
}

/**
 * How a found player reads in the list.
 *
 * The address is in there because two rooms can hold the same model, and somebody with three NODEs
 * needs to tell them apart by something.
 */
export function playerLabel(player: { name: string; model?: string; address: string; needsSetup?: boolean }): string {
    const model = player.model === undefined ? '' : ` — ${player.model}`;
    const setup = player.needsSetup === true ? ' (needs setting up)' : '';
    return `${player.name}${model}${setup} · ${player.address}`;
}

/** The settings as typed: trimmed, and absent rather than empty. */
export function settingsFrom(address: string): PlayerSettings {
    const typed = address.trim();
    return typed === '' ? {} : { address: typed };
}
