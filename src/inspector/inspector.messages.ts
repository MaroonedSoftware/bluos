import type { BrowseOutcome, DiscoveredPlayer } from '../discovery/discovery.js';

/**
 * What the settings panel and the plugin say to each other, beyond the settings themselves.
 *
 * The panel never sends the settings here. It writes them with `setSettings`, the Stream Deck app
 * hands them to the plugin, and the plugin checks what it was handed. So the answer the panel shows
 * is always about the settings the keys are actually using, rather than about what the panel
 * believes it typed. The sibling plugin arrived at the same rule for global settings; the only
 * difference here is which message the app delivers.
 */
export type ToPlugin = { event: 'testConnection' } | { event: 'discover' } | { event: 'presets' };

export type ToInspector =
    | { event: 'connection'; ok: boolean; text: string }
    | {
          event: 'players';
          players: DiscoveredPlayer[];
          /** More may still arrive, so a panel can show it is looking rather than that it found nothing. */
          browsing: boolean;
          outcome: BrowseOutcome;
      }
    | {
          event: 'presetList';
          presets: { id: number; name: string }[];
          /** Why there is no list, when there is none: no player yet, or one that did not answer. */
          problem?: string;
      };

export function isToPlugin(value: unknown): value is ToPlugin {
    const event = (value as { event?: unknown } | null)?.event;
    return typeof value === 'object' && value !== null && (event === 'testConnection' || event === 'discover' || event === 'presets');
}

export function isToInspector(value: unknown): value is ToInspector {
    const message = value as { event?: unknown; ok?: unknown; text?: unknown; players?: unknown } | null;
    if (typeof message !== 'object' || message === null) return false;
    if (message.event === 'connection') return typeof message.ok === 'boolean' && typeof message.text === 'string';
    if (message.event === 'presetList') return Array.isArray((message as { presets?: unknown }).presets);
    return message.event === 'players' && Array.isArray(message.players);
}

/** A player's presets specifically. */
export function isPresetListAnswer(value: unknown): value is Extract<ToInspector, { event: 'presetList' }> {
    return isToInspector(value) && value.event === 'presetList';
}

/** A connection answer specifically, for a panel that tells the two apart. */
export function isConnectionAnswer(value: unknown): value is Extract<ToInspector, { event: 'connection' }> {
    return isToInspector(value) && value.event === 'connection';
}

/** A list of players specifically. */
export function isPlayersAnswer(value: unknown): value is Extract<ToInspector, { event: 'players' }> {
    return isToInspector(value) && value.event === 'players';
}
