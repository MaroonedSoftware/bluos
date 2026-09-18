import type { PlayerSettings } from '../player.settings.js';

export type InputSettings = {
    /** The input's id, as the player lists it and as `/Status` reports it while it plays. */
    input?: string;
};

export type InputKeySettings = PlayerSettings & InputSettings;

export function inputFrom(settings: unknown): string | undefined {
    const given = (typeof settings === 'object' && settings !== null ? settings : {}) as { input?: unknown };
    return typeof given.input === 'string' && given.input.trim() !== '' ? given.input : undefined;
}
