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

/** Every action this plugin registers. The manifest must declare exactly these. */
export const ACTION_IDS = [NOW_PLAYING, TRANSPORT, NEXT, PREVIOUS, VOLUME, VOLUME_DIAL, PRESET, INPUT] as const;
