import streamDeck from '@elgato/streamdeck';

import { NowPlayingAction } from './actions/now.playing.action.js';
import { NowPlayingKeys } from './actions/now.playing.js';
import type { KeysWorld } from './actions/player.keys.js';
import { PresetAction } from './actions/preset.action.js';
import { PresetKeys } from './actions/preset.keys.js';
import { NextAction, PreviousAction } from './actions/skip.action.js';
import { NextKeys, PreviousKeys } from './actions/skip.keys.js';
import { TransportAction } from './actions/transport.action.js';
import { TransportKeys } from './actions/transport.keys.js';
import { VolumeAction } from './actions/volume.action.js';
import { VolumeDialAction } from './actions/volume.dial.action.js';
import { VolumeDial } from './actions/volume.dial.js';
import { VolumeKeys } from './actions/volume.keys.js';
import { classify, describe } from './bluos/connection.failure.js';
import { probePlayer } from './bluos/probe.js';
import { ArtworkCache } from './display/artwork.js';
import { bonjourBrowser } from './discovery/bonjour.browser.js';
import { Discovery } from './discovery/discovery.js';
import { WatcherPool } from './bluos/watcher.pool.js';
import { isToPlugin, type ToInspector } from './inspector/inspector.messages.js';
import { addressFor, describeSettings, originFor, type GlobalSettings, type PlayerSettings } from './player.settings.js';

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

// One cache for the whole plugin: a Now Playing key and a dial on the same player want the same
// cover, and fetching it twice would be two requests for one picture.
const artwork = new ArtworkCache({ userAgent });
const nowPlaying = new NowPlayingKeys(world, artwork);
const transport = new TransportKeys(world);
const next = new NextKeys(world);
const previous = new PreviousKeys(world);
const volume = new VolumeKeys(world);
const dial = new VolumeDial(world, artwork);
const preset = new PresetKeys(world, artwork);

streamDeck.actions.registerAction(new NowPlayingAction(nowPlaying));
streamDeck.actions.registerAction(new TransportAction(transport));
streamDeck.actions.registerAction(new NextAction(next));
streamDeck.actions.registerAction(new PreviousAction(previous));
streamDeck.actions.registerAction(new VolumeAction(volume));
streamDeck.actions.registerAction(new VolumeDialAction(dial));
streamDeck.actions.registerAction(new PresetAction(preset));

/** Every set of keys, for the events that are about all of them rather than about one key. */
const everyKey = [nowPlaying, transport, next, previous, volume, dial, preset];

const discovery = new Discovery({ browser: bonjourBrowser(), client: { userAgent } });

/** Tells the open panel what is on the network, as it is found. */
function reportPlayers(): void {
    discovery.browse((players, browsing, outcome) => {
        if (streamDeck.ui.action === undefined) {
            // Nobody is listening any more, so there is no reason to keep a multicast socket open.
            discovery.stop();
            return;
        }
        const message: ToInspector = { event: 'players', players, browsing, outcome };
        void streamDeck.ui.sendToPropertyInspector(message);
    });
}

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

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>(ev => {
    global = ev.settings;
    // A key with no address of its own follows the default, so moving the default moves those keys.
    // Each key class remembers its own keys' settings, so this asks the app for nothing and cannot
    // race a key appearing while it runs.
    for (const keys of everyKey) keys.globalSettingsChanged();
});

/**
 * Tells the open panel what presets its key's player has, for the panel's list.
 *
 * The panel cannot ask the player itself: it is a Chromium page, and the player is on the other side
 * of a network the plugin can reach and the page may not. So the plugin reads the list and sends it.
 */
async function reportPresets(): Promise<void> {
    const open = streamDeck.ui.action;
    if (open === undefined) return;
    const origin = originFor(await open.getSettings<PlayerSettings>(), global);
    const tell = (message: ToInspector): Promise<void> => streamDeck.ui.sendToPropertyInspector(message);
    if (origin === undefined) {
        await tell({ event: 'presetList', presets: [], problem: 'Choose a player first, and its presets will be listed here.' });
        return;
    }
    try {
        const list = await pool.for(origin).client.presets(AbortSignal.timeout(10_000));
        await tell({
            event: 'presetList',
            presets: list.presets.map(({ id, name }) => ({ id, name })),
            ...(list.presets.length === 0 ? { problem: 'This player has no presets yet. Save some in the BluOS app.' } : {}),
        });
    } catch (error) {
        await tell({ event: 'presetList', presets: [], problem: describe(classify(error)).sentence });
    }
}

streamDeck.ui.onSendToPlugin(ev => {
    if (!isToPlugin(ev.payload)) return;
    if (ev.payload.event === 'discover') reportPlayers();
    else if (ev.payload.event === 'presets') void reportPresets();
    else void reportConnection();
});

// The panel closed, so the browse has nobody to tell. An mDNS browser left running holds a
// multicast socket and goes on answering the whole network's queries.
streamDeck.ui.onDidDisappear(() => discovery.stop());

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
