import streamDeck from '@elgato/streamdeck';

import { NowPlayingAction } from './actions/now.playing.action.js';
import { NowPlayingKeys } from './actions/now.playing.js';
import type { KeysWorld } from './actions/player.keys.js';
import { probePlayer } from './bluos/probe.js';
import { WatcherPool } from './bluos/watcher.pool.js';
import { isToPlugin, type ToInspector } from './inspector/inspector.messages.js';
import { addressFor, describeSettings, type GlobalSettings, type PlayerSettings } from './player.settings.js';

/**
 * The plugin the Stream Deck app launches, as one ES module with no `node_modules` beside it.
 *
 * Everything is wired here rather than in decorators: an action is a thin shell over a plain class
 * that holds the decisions, and this file is where the two are joined and given what they need.
 */
streamDeck.logger.setLevel('info');
const logger = streamDeck.logger.createScope('bluos');

const userAgent = `bluos-streamdeck/${streamDeck.info.plugin.version}`;
const pool = new WatcherPool({ userAgent });

/** The settings every key shares. Read once at startup and kept in step from then on. */
let global: GlobalSettings = {};

const world: KeysWorld = {
    pool,
    global: () => global,
    log: sentence => logger.info(sentence),
};

const nowPlaying = new NowPlayingKeys(world);
streamDeck.actions.registerAction(new NowPlayingAction(nowPlaying));

/** Every set of keys, for the events that are about all of them rather than about one key. */
const everyKey = [nowPlaying];

/**
 * Tells the open settings panel what the plugin makes of the address it was handed.
 *
 * Only while a panel is open: the panel asks for a check itself, and nobody else reads the answer.
 * It runs on the settings the APP delivered rather than on what the panel typed, so what the panel
 * shows is about the settings a key is actually using.
 */
async function reportConnection(): Promise<void> {
    const open = streamDeck.ui.action;
    if (open === undefined) return;
    const settings = await open.getSettings<PlayerSettings>();
    const result = await probePlayer(addressFor(settings, global), { userAgent });
    const message: ToInspector = { event: 'connection', ...result };
    await streamDeck.ui.sendToPropertyInspector(message);
}

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>(async ev => {
    global = ev.settings;
    // A key with no address of its own follows the default, so moving the default moves those keys.
    // Each key's own settings are asked for rather than remembered, because the app is what holds
    // them, and a key that has since been given its own address must not be dragged along.
    const settings = new Map<string, PlayerSettings>();
    await Promise.all(
        streamDeck.actions.toArray().map(async candidate => {
            if (candidate.isKey()) settings.set(candidate.id, await candidate.getSettings<PlayerSettings>());
        }),
    );
    for (const keys of everyKey) keys.globalSettingsChanged(id => settings.get(id) ?? {});
});

streamDeck.ui.onSendToPlugin(ev => {
    if (isToPlugin(ev.payload)) void reportConnection();
});

// A key's own player changed. The panel writes the address with `setSettings` and the app delivers
// it here, which is what re-points the key: the panel never tells the plugin what it thinks it typed.
streamDeck.settings.onDidReceiveSettings<PlayerSettings>(ev => {
    logger.info(`${ev.action.id} is pointed at ${describeSettings(ev.payload.settings, global)}`);
});

// Every socket slept through the suspend, and none of them will say so until its deadline.
streamDeck.system.onSystemDidWakeUp(() => pool.refreshAll());

await streamDeck.connect();
global = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
logger.info(`BluOS plugin ${streamDeck.info.plugin.version} connected; default player is ${global.defaultAddress ?? 'unset'}.`);
