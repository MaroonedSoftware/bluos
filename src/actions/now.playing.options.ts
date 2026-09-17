import type { PlayerSettings } from '../player.settings.js';

/**
 * One Now Playing key's own settings: what it draws over the cover.
 *
 * Action settings rather than global ones, because two keys can want different things (a large
 * cover-only key beside a small one with the title) and nothing here is a secret. Elgato exports an
 * action's settings with a profile, which is exactly right for a display choice.
 *
 * Absent means SHOWN, so a key placed before these existed, or never configured, draws everything.
 */
export type NowPlayingSettings = {
    showProgress?: boolean;
    showTitle?: boolean;
};

/**
 * Everything a Now Playing key stores: which player, and what to draw.
 *
 * Every action's settings are `PlayerSettings` plus whatever that action alone decides, which is why
 * `PlayerKeys` takes the narrow type and each key class widens it. One settings panel writes all of
 * them, because the Stream Deck app opens one panel for the whole plugin.
 */
export type NowPlayingKeySettings = PlayerSettings & NowPlayingSettings;

export interface NowPlayingOptions {
    /** The bar along the top. Turning it off also means far fewer redraws. */
    progress: boolean;
    /** The two lines the player says to use. Never the plugin's own words for a failure. */
    title: boolean;
}

export const SHOW_EVERYTHING: NowPlayingOptions = { progress: true, title: true };

/** What a key's settings ask it to draw. Anything but an explicit `false` is shown. */
export function optionsFrom(settings: unknown): NowPlayingOptions {
    const given = (typeof settings === 'object' && settings !== null ? settings : {}) as NowPlayingSettings;
    return { progress: given.showProgress !== false, title: given.showTitle !== false };
}
