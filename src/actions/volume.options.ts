import type { PlayerSettings } from '../player.settings.js';

/** What a volume key does when it is pressed. */
export type VolumeDirection = 'up' | 'down' | 'mute';

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
};

export type VolumeKeySettings = PlayerSettings & VolumeSettings;

export interface VolumeOptions {
    direction: VolumeDirection;
    step: number;
    showLevel: boolean;
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
        direction: given.direction === 'down' || given.direction === 'mute' ? given.direction : 'up',
        step,
        showLevel: given.showLevel !== false,
    };
}
