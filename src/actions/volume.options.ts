import type { PlayerSettings } from '../player.settings.js';

/** What a volume key does when it is pressed. */
export type VolumeDirection = 'up' | 'down' | 'mute' | 'set';

/**
 * One volume key's own settings.
 *
 * One action with a direction rather than three separate ones. The panel is needed anyway for the
 * step, and three entries in the app's action list for what is one idea reads worse than one
 * configurable entry. The cost is that the manifest's icon cannot say which way a key goes, which
 * is why the key draws its own face at runtime instead.
 */
export type VolumeSettings = {
    direction?: VolumeDirection;
    /** How much one press moves the level, out of 100. */
    step?: number;
    /** The level in the key's title. Absent means shown. */
    showLevel?: boolean;
    /** The loudest this key will ask for, out of 100. Absent means no limit. */
    maxVolume?: number;
    /** The level a "set" key goes to, out of 100. */
    level?: number;
};

/** What pressing the dial does. Whichever it is not, a tap on the strip does instead. */
export type DialPress = 'mute' | 'playPause';

/** A volume dial's own settings. */
export type DialSettings = {
    /** The loudest this dial will ask for, out of 100. Absent means no limit. */
    maxVolume?: number;
    press?: DialPress;
};

/** What a dial's press does, from its settings. Mute unless told otherwise, as the manifest says. */
export function pressFrom(settings: unknown): DialPress {
    const given = (typeof settings === 'object' && settings !== null ? settings : {}) as { press?: unknown };
    return given.press === 'playPause' ? 'playPause' : 'mute';
}

/** A level to set, as a whole number out of 100, or the default when there is none. */
export const DEFAULT_SET_LEVEL = 30;

export type VolumeDialSettings = PlayerSettings & DialSettings;

/** A cap read from settings: a whole number from 1 to 100, and 100, meaning none, otherwise. */
export function capFrom(settings: unknown): number {
    const given = (typeof settings === 'object' && settings !== null ? settings : {}) as { maxVolume?: unknown };
    const cap = given.maxVolume;
    return typeof cap === 'number' && Number.isFinite(cap) ? Math.min(100, Math.max(1, Math.round(cap))) : 100;
}

export type VolumeKeySettings = PlayerSettings & VolumeSettings;

export interface VolumeOptions {
    direction: VolumeDirection;
    step: number;
    showLevel: boolean;
    cap: number;
    /** Where a "set" key goes. */
    level: number;
}

/**
 * Five out of a hundred, so twenty presses cross the whole range.
 *
 * Larger than a dial's step, because a key is pressed deliberately where a dial is turned
 * continuously, and because a key has no way to move a little.
 */
export const DEFAULT_KEY_STEP = 5;

export function volumeOptionsFrom(settings: unknown): VolumeOptions {
    const given = (typeof settings === 'object' && settings !== null ? settings : {}) as VolumeSettings;
    const step = typeof given.step === 'number' && Number.isFinite(given.step) ? Math.min(50, Math.max(1, Math.round(given.step))) : DEFAULT_KEY_STEP;
    return {
        direction: given.direction === 'down' || given.direction === 'mute' || given.direction === 'set' ? given.direction : 'up',
        step,
        showLevel: given.showLevel !== false,
        cap: capFrom(settings),
        level:
            typeof given.level === 'number' && Number.isFinite(given.level) ? Math.min(100, Math.max(0, Math.round(given.level))) : DEFAULT_SET_LEVEL,
    };
}
