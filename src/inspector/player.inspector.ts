import { parseAddress } from '../bluos/address.js';
import { isConnectionAnswer, isPlayersAnswer } from './inspector.messages.js';
import { inspectorMessages, playerLabel, settingsFrom } from './inspector.protocol.js';

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

type PanelSettings = {
    address?: string;
    showTitle?: boolean;
    showProgress?: boolean;
    direction?: 'up' | 'down' | 'mute';
    step?: number;
    showLevel?: boolean;
};

/**
 * The actions with anything to set beyond the player.
 *
 * The Stream Deck app opens ONE settings panel for the whole plugin, so the page carries every
 * group and shows the one that belongs to whichever action it was opened on.
 */
const NOW_PLAYING = 'com.maroonedsoftware.bluos.now-playing';
const VOLUME = 'com.maroonedsoftware.bluos.volume';
const DEFAULT_STEP = 5;

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
    const found = field<HTMLSelectElement>('found');
    const again = field<HTMLButtonElement>('again');
    const volume = field<HTMLDivElement>('volume');
    const direction = field<HTMLSelectElement>('direction');
    const step = field<HTMLInputElement>('step');
    const stepRow = field<HTMLDivElement>('stepRow');
    const showLevel = field<HTMLInputElement>('showLevel');

    // The display choices belong to the Now Playing key and to nothing else, so the panel only
    // offers them where they do something. The app opens ONE panel for every action in this plugin.
    display.hidden = parsed.action !== NOW_PLAYING;
    volume.hidden = parsed.action !== VOLUME;

    /** A mute key has nothing to step by, so the field goes rather than sitting there meaning nothing. */
    const showStep = (): void => {
        stepRow.hidden = direction.value === 'mute';
    };

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
        const knob = volume.hidden
            ? {}
            : { direction: direction.value as 'up' | 'down' | 'mute', step: Number(step.value) || DEFAULT_STEP, showLevel: showLevel.checked };
        send(messages.setSettings({ ...settingsFrom(typed), ...shown, ...knob }));
        if (typed !== '') send(messages.setGlobalSettings({ defaultAddress: typed }));
    };

    /**
     * Shows what the plugin found on the network.
     *
     * The list and the field are ONE setting: choosing from the list fills the field in, and the
     * field is what a key actually uses. There is no auto-or-manual mode, which kills the whole
     * class of "I picked a device but it is still using the old address" confusions.
     */
    const listPlayers = (
        players: { name: string; model?: string; address: string; needsSetup?: boolean }[],
        browsing: boolean,
        outcome: string,
    ): void => {
        const first =
            browsing && players.length === 0
                ? 'Looking for players…'
                : players.length === 0
                  ? outcome === 'unavailable'
                      ? 'Could not search the network'
                      : 'No players answered'
                  : 'Choose a player…';
        found.replaceChildren(new Option(first, ''), ...players.map(player => new Option(playerLabel(player), player.address)));
        found.value = players.some(player => player.address === address.value.trim()) ? address.value.trim() : '';
        again.disabled = browsing;

        if (browsing || players.length > 0) return;
        // A network that filters multicast is a normal thing, not a fault, so it is explained
        // rather than left as an empty list somebody stares at.
        say(
            outcome === 'unavailable'
                ? 'The network could not be searched. Enter the player’s address below instead.'
                : 'No players answered. Multicast may be blocked between this computer and the player. Enter its address below instead.',
            'quiet',
        );
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
        direction.value = parsed.payload?.settings?.direction ?? 'up';
        step.value = String(parsed.payload?.settings?.step ?? DEFAULT_STEP);
        showLevel.checked = parsed.payload?.settings?.showLevel !== false;
        showStep();
        // A key that has never been configured may still have adopted the default by the time the
        // panel opens, so ask the app rather than trusting what came with the panel.
        send(messages.getSettings());
        send(messages.discover());
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
            direction.value = settings?.direction ?? 'up';
            step.value = String(settings?.step ?? DEFAULT_STEP);
            showLevel.checked = settings?.showLevel !== false;
            showStep();
            return;
        }
        if (message.event !== 'sendToPropertyInspector') return;
        if (isPlayersAnswer(message.payload)) {
            listPlayers(message.payload.players, message.payload.browsing, message.payload.outcome);
            return;
        }
        if (isConnectionAnswer(message.payload)) {
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
    again.addEventListener('click', () => {
        again.disabled = true;
        send(messages.discover());
    });
    found.addEventListener('change', () => {
        if (found.value === '') return;
        address.value = found.value;
        save();
        check();
    });
    // Elgato's rule for a checkbox is that it saves on every tick, with no Save button anywhere.
    for (const box of [showTitle, showProgress, showLevel]) box.addEventListener('change', save);
    direction.addEventListener('change', () => {
        showStep();
        save();
    });
    step.addEventListener('change', save);
};
