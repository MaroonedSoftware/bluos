const SIZE = 144;
const INK = '#2e7bd6';

/** A generic input: a socket, for an input the player gave no icon for. */
const SOCKET = '<circle cx="72" cy="54" r="30" fill="none" stroke="#ffffff" stroke-width="8"/>' + '<circle cx="72" cy="54" r="9" fill="#ffffff"/>';

/**
 * What an input key draws: the player's own icon for the input, and an outline while it is the one
 * playing.
 *
 * The icon sits high, as the volume glyph does, because the Stream Deck app writes the input's name
 * along the bottom of the key over whatever the image put there.
 *
 * The icon is a raster from the player, embedded through `xlink:href`, the spelling the app's Qt
 * renderer is known to draw on a key.
 */
export function inputSvg(options: { icon?: string; active: boolean; stale: boolean }): string {
    const faint = options.stale ? ' opacity="0.4"' : '';
    const picture =
        options.icon === undefined
            ? `<g${faint}>${SOCKET}</g>`
            : `<image x="36" y="18" width="72" height="72" preserveAspectRatio="xMidYMid meet" xlink:href="${options.icon}"${faint}/>`;
    const outline =
        options.active && !options.stale ? `<rect x="4" y="4" width="136" height="136" rx="16" fill="none" stroke="${INK}" stroke-width="8"/>` : '';
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
        `<rect width="${SIZE}" height="${SIZE}" fill="#0c0e0d"/>` +
        picture +
        outline +
        `</svg>`
    );
}
