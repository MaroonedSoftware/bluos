import type { PlayerSettings } from '../player.settings.js';

/**
 * Which preset a key plays: one of the player's own, by id, or the next or previous one.
 *
 * Next and previous are the specification's `id=+1` and `id=-1`, which "loop around from top to
 * bottom and bottom to top", so a pair of keys can step through every preset on the player.
 */
export type PresetChoice = number | 'next' | 'previous';

export type PresetSettings = {
    preset?: PresetChoice;
};

export type PresetKeySettings = PlayerSettings & PresetSettings;

/** The choice a key's settings make, or `undefined` for a key nobody has pointed at a preset yet. */
export function presetFrom(settings: unknown): PresetChoice | undefined {
    const given = (typeof settings === 'object' && settings !== null ? settings : {}) as { preset?: unknown };
    const preset = given.preset;
    if (preset === 'next' || preset === 'previous') return preset;
    return typeof preset === 'number' && Number.isInteger(preset) ? preset : undefined;
}

/** What `/Preset?id=` takes for a choice. */
export function presetParameter(choice: PresetChoice): string {
    return choice === 'next' ? '+1' : choice === 'previous' ? '-1' : String(choice);
}
