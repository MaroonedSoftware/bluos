import { parseAddress } from './bluos/address.js';

/**
 * Which player a key talks to.
 *
 * ACTION settings, not global ones, and this is the one place the sibling plugin's shape is
 * deliberately inverted. It keeps its settings global because an API key acts as the account that
 * issued it and Elgato writes an action's settings in plain text into every profile somebody
 * exports. BluOS has no credential at all: a key here holds a LAN address and nothing else, so the
 * reason is gone. What arrives in its place is the opposite need, because four dials on a Stream
 * Deck + are naturally four rooms, and a global address would make that impossible.
 *
 * A type alias rather than an interface, because the SDK's settings calls take a JSON object and an
 * interface does not satisfy an index signature.
 */
export type PlayerSettings = {
    /** The player's address as it was typed or picked. Absent on a key nobody has configured. */
    address?: string;
};

/**
 * The settings every key shares.
 *
 * Only one thing is global, and it is a convenience rather than a source of truth: the last player
 * chosen in any panel, so that a freshly dragged key works before anybody opens its settings.
 */
export type GlobalSettings = {
    defaultAddress?: string;
};

/** The address a key should use: its own, or the last one chosen anywhere. */
export function addressFor(settings: PlayerSettings, global: GlobalSettings): string | undefined {
    const own = settings.address?.trim();
    return own !== undefined && own !== '' ? own : global.defaultAddress?.trim() || undefined;
}

/** The player a key is pointed at, or `undefined` while it is unset or unreadable. */
export function originFor(settings: PlayerSettings, global: GlobalSettings): string | undefined {
    const parsed = parseAddress(addressFor(settings, global));
    return 'origin' in parsed ? parsed.origin : undefined;
}

/**
 * The address to write into a key's own settings when it appears without one.
 *
 * Writing it, rather than quietly falling back at the moment of use, is deliberate. A key's settings
 * then describe the key truthfully, the panel needs no special case for "inherited", and a profile
 * somebody exports carries the player it was actually using. It returns `undefined` when there is
 * nothing to adopt or the key already has its own, so the caller writes once and never again.
 */
export function addressToAdopt(settings: PlayerSettings, global: GlobalSettings): string | undefined {
    const own = settings.address?.trim();
    if (own !== undefined && own !== '') return undefined;
    const fallback = global.defaultAddress?.trim();
    return fallback === undefined || fallback === '' ? undefined : fallback;
}

/** The settings as a log line may carry them. Nothing here is secret, which is why this is short. */
export function describeSettings(settings: PlayerSettings, global: GlobalSettings): string {
    const address = addressFor(settings, global);
    if (address === undefined) return 'no player';
    const parsed = parseAddress(address);
    return 'origin' in parsed ? parsed.origin : `${address} (which does not read as an address)`;
}
