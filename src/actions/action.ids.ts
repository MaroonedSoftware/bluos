/**
 * Every action's id, as the manifest names it.
 *
 * Here rather than spelled out at each `@action` decorator, because a manifest test asserts that
 * these and the manifest agree: Elgato forbids changing an action's UUID after publishing, so a
 * typo caught by a test is a typo that never ships.
 */
export const PLUGIN = 'com.maroonedsoftware.bluos';

export const NOW_PLAYING = `${PLUGIN}.now-playing`;
export const TRANSPORT = `${PLUGIN}.transport`;
export const NEXT = `${PLUGIN}.next`;
export const PREVIOUS = `${PLUGIN}.previous`;
export const VOLUME = `${PLUGIN}.volume`;
export const VOLUME_DIAL = `${PLUGIN}.volume-dial`;
export const PRESET = `${PLUGIN}.preset`;
export const INPUT = `${PLUGIN}.input`;
export const SHUFFLE = `${PLUGIN}.shuffle`;
export const REPEAT = `${PLUGIN}.repeat`;
export const LOVE = `${PLUGIN}.love`;
export const STRIP = `${PLUGIN}.strip`;
export const STOP = `${PLUGIN}.stop`;
export const SLEEP = `${PLUGIN}.sleep`;

/** Every action this plugin registers. The manifest must declare exactly these. */
export const ACTION_IDS = [
    NOW_PLAYING,
    TRANSPORT,
    NEXT,
    PREVIOUS,
    VOLUME,
    VOLUME_DIAL,
    PRESET,
    INPUT,
    SHUFFLE,
    REPEAT,
    LOVE,
    STRIP,
    STOP,
    SLEEP,
] as const;

/** The actions that live on a Stream Deck + dial rather than on a key, and the layout each draws into. */
export const ENCODERS: Readonly<Record<string, string>> = {
    [VOLUME_DIAL]: 'layouts/volume.json',
    [STRIP]: 'layouts/strip.json',
};
