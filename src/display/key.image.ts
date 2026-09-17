/** The key's own coordinate space. Stream Deck scales it to 72 or 144 pixels, whichever the device has. */
const SIZE = 144;

/**
 * How finely the bar moves.
 *
 * Each step is a redraw, and a redraw carries the whole cover again, so this is the trade between a
 * bar that looks continuous and a plugin that posts a cover down the socket every second. Thirty-six
 * steps is a redraw every five to eight seconds on an ordinary track, and two pixels a step on a
 * 72-pixel key.
 */
export const PROGRESS_STEPS = 36;

const INK = '#2e7bd6';
const CARBON = '#0c0e0d';
const GROOVE = '#1d4e8a';
const LABEL = '#f5f7fa';
const PALE = '#57625c';

/** What the Now Playing key draws. */
export interface NowPlayingFace {
    /** The cover as a data URI. Absent draws the record placeholder. */
    cover?: string;
    /** How far through, in steps of {@link PROGRESS_STEPS}. Absent draws no bar. */
    step?: number;
    /** The reading is from before an attempt that failed, so nothing on the key may look live. */
    stale: boolean;
    /**
     * The dark shade along the bottom that the title is read against. `false` for a key showing no
     * title, where it would only darken the cover for nothing.
     */
    shade: boolean;
}

/** Which step a fraction of the way through falls on. */
export function progressStep(fraction: number, steps = PROGRESS_STEPS): number {
    return Math.min(steps, Math.max(0, Math.floor(fraction * steps)));
}

/**
 * The Now Playing key as an SVG: the cover, a shade under the title, and the bar along the top edge.
 *
 * The cover is EMBEDDED in the SVG and the Stream Deck app rasterises the lot, which is why this
 * plugin ships no image decoder: a native one cannot travel in a packed plugin, and a JavaScript one
 * is a megabyte to produce the 72 pixels the app would scale to anyway.
 *
 * **`xlink:href`, never the bare `href`.** The app's renderer is Qt's, not a browser's, and SVG 1.1
 * is the spelling it is sure to know. The sibling plugin measured this on a real Stream Deck +: the
 * cover shows with `xlink:href` and the bare `href` is not worth the risk.
 *
 * The bar is along the TOP because the app draws the title along the bottom, over the shade.
 *
 * A stale reading is drawn faint rather than blanked. One missed reading must not throw away
 * something true, and the paleness is what says "this is the last thing known" rather than "this is
 * what is playing now".
 */
export function nowPlayingSvg(face: NowPlayingFace): string {
    const opacity = face.stale ? ' opacity="0.4"' : '';
    const picture =
        face.cover !== undefined
            ? `<image x="0" y="0" width="${SIZE}" height="${SIZE}" preserveAspectRatio="xMidYMid slice" xlink:href="${face.cover}"${opacity}/>`
            : `<g${opacity}>${record()}</g>`;
    const bar =
        face.step === undefined
            ? ''
            : `<rect width="${SIZE}" height="8" fill="#000000" fill-opacity="0.6"/>` +
              `<rect width="${((face.step / PROGRESS_STEPS) * SIZE).toFixed(1)}" height="8" fill="${face.stale ? PALE : INK}"/>`;
    const shade = face.shade ? `<rect x="0" y="${SIZE - 62}" width="${SIZE}" height="62" fill="url(#shade)"/>` : '';

    return (
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
        `<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.85"/>` +
        `</linearGradient></defs>` +
        `<rect width="${SIZE}" height="${SIZE}" fill="${CARBON}"/>` +
        picture +
        shade +
        bar +
        `</svg>`
    );
}

/** The record drawn where there is no cover: nothing playing, or a cover that could not be had. */
function record(): string {
    const c = SIZE / 2;
    return (
        `<circle cx="${c}" cy="${c}" r="${SIZE * 0.47}" fill="${INK}"/>` +
        [0.345, 0.29, 0.235].map(r => `<circle cx="${c}" cy="${c}" r="${SIZE * r}" fill="none" stroke="${GROOVE}" stroke-width="2"/>`).join('') +
        `<circle cx="${c}" cy="${c}" r="${SIZE * 0.2}" fill="${LABEL}"/>` +
        `<circle cx="${c}" cy="${c}" r="${SIZE * 0.06}" fill="${CARBON}"/>`
    );
}

/**
 * The SVG as something `setImage` will take.
 *
 * `data:image/svg+xml,` plus `encodeURIComponent` is Elgato's own documented form, and it matters
 * that it is not base64: the cover inside is already base64, and wrapping base64 in base64 would
 * grow every redraw by a third for nothing.
 */
export function asKeyImage(svg: string): string {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
