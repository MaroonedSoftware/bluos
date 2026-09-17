import { parseAddress } from '../bluos/address.js';
import { isToInspector } from './inspector.messages.js';
import { inspectorMessages, settingsFrom } from './inspector.protocol.js';

/**
 * The settings panel's script, run by the Stream Deck app in its own browser beside `player.html`.
 *
 * Built as a plain script rather than a module, because the page loads it with a bare
 * `<script src="player.js">` and the app serves it off the filesystem where a module's imports
 * would have nowhere to resolve to.
 */

declare global {
    interface Window {
        connectElgatoStreamDeckSocket?: (port: string, uuid: string, event: string, info: string, actionInfo: string) => void;
    }
}

interface ActionInfo {
    action: string;
    payload?: { settings?: PanelSettings };
}

type PanelSettings = { address?: string; showTitle?: boolean; showProgress?: boolean };

/** The one action with anything to show beyond the player. */
const NOW_PLAYING = 'com.maroonedsoftware.bluos.now-playing';

const field = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, _info, actionInfo) => {
    const parsed = JSON.parse(actionInfo) as ActionInfo;
    const messages = inspectorMessages(uuid, parsed.action);
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);

    const address = field<HTMLInputElement>('address');
    const status = field<HTMLParagraphElement>('status');
    const test = field<HTMLButtonElement>('test');
    const display = field<HTMLDivElement>('display');
    const showTitle = field<HTMLInputElement>('showTitle');
    const showProgress = field<HTMLInputElement>('showProgress');

    // The display choices belong to the Now Playing key and to nothing else, so the panel only
    // offers them where they do something. The app opens ONE panel for every action in this plugin.
    display.hidden = parsed.action !== NOW_PLAYING;

    /** Whether the plugin has been asked something the panel is still waiting on an answer to. */
    let asking = false;

    const say = (text: string, tone: 'ok' | 'bad' | 'quiet'): void => {
        status.textContent = text;
        status.className = `status ${tone}`;
    };

    const send = (message: unknown): void => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    /**
     * Saves on every change, which is Elgato's rule for a settings panel: no Save button.
     *
     * Both settings are written. The key's own, because that is which player it talks to; and the
     * global default, so the NEXT key somebody drags onto the deck starts on the same player
     * instead of asking again.
     */
    const save = (): void => {
        const typed = address.value.trim();
        const shown = display.hidden ? {} : { showTitle: showTitle.checked, showProgress: showProgress.checked };
        send(messages.setSettings({ ...settingsFrom(typed), ...shown }));
        if (typed !== '') send(messages.setGlobalSettings({ defaultAddress: typed }));
    };

    /** Asks the plugin what it makes of the settings it was handed. */
    const check = (): void => {
        const parsedAddress = parseAddress(address.value);
        if ('problem' in parsedAddress) {
            // The panel can read an address itself, so it says so without a round trip. Anything
            // about the PLAYER has to come from the plugin, which is the side with a socket.
            asking = false;
            say(parsedAddress.problem === 'empty' ? 'Enter the player’s address.' : 'That does not read as an address.', 'quiet');
            return;
        }
        asking = true;
        say('Looking for the player…', 'quiet');
        send(messages.testConnection());
    };

    socket.addEventListener('open', () => {
        send(messages.register(registerEvent));
        address.value = parsed.payload?.settings?.address ?? '';
        showTitle.checked = parsed.payload?.settings?.showTitle !== false;
        showProgress.checked = parsed.payload?.settings?.showProgress !== false;
        // A key that has never been configured may still have adopted the default by the time the
        // panel opens, so ask the app rather than trusting what came with the panel.
        send(messages.getSettings());
        say('', 'quiet');
    });

    socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data)) as { event?: string; payload?: unknown };
        if (message.event === 'didReceiveSettings') {
            const settings = (message.payload as { settings?: PanelSettings } | undefined)?.settings;
            if (settings?.address !== undefined && document.activeElement !== address) address.value = settings.address;
            // Absent means shown, which is the same rule the plugin reads them by.
            showTitle.checked = settings?.showTitle !== false;
            showProgress.checked = settings?.showProgress !== false;
            return;
        }
        if (message.event === 'sendToPropertyInspector' && isToInspector(message.payload)) {
            if (!asking) return;
            asking = false;
            say(message.payload.text, message.payload.ok ? 'ok' : 'bad');
        }
    });

    // Elgato's rule is that settings save on change with validation feedback and no Save button. So
    // typing saves, and the check waits for a pause rather than firing on every keystroke.
    let settling: ReturnType<typeof setTimeout> | undefined;
    address.addEventListener('input', () => {
        save();
        clearTimeout(settling);
        settling = setTimeout(check, 600);
    });
    address.addEventListener('change', () => {
        save();
        check();
    });
    test.addEventListener('click', () => {
        save();
        check();
    });
    // Elgato's rule for a checkbox is that it saves on every tick, with no Save button anywhere.
    for (const box of [showTitle, showProgress]) box.addEventListener('change', save);
};
