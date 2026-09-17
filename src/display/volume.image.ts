import type { VolumeDirection } from '../actions/volume.options.js';

const SIZE = 144;
const INK = '#ffffff';
const PALE = '#6c7570';

/** A speaker, drawn once and pointed at by every face. */
const SPEAKER = 'M18 58h22l30-27v82L40 86H18V58Z';

/**
 * What a volume key draws.
 *
 * The key draws its own face rather than taking one from the manifest, because this is one action
 * with a direction setting: the manifest has a single icon for all three, and a key that says "up"
 * when it goes down would be worse than no picture at all.
 */
export function volumeSvg(direction: VolumeDirection, options: { muted: boolean; stale: boolean } = { muted: false, stale: false }): string {
    const colour = options.stale ? PALE : INK;
    const glyph =
        direction === 'mute' || options.muted
            ? `<path d="M92 58l34 34M126 58l-34 34" stroke="${colour}" stroke-width="9" stroke-linecap="round" fill="none"/>`
            : direction === 'up'
              ? waves(colour) + `<path d="M104 26h30M119 11v30" stroke="${colour}" stroke-width="9" stroke-linecap="round" fill="none"/>`
              : waves(colour) + `<path d="M104 26h30" stroke="${colour}" stroke-width="9" stroke-linecap="round" fill="none"/>`;

    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
        `<rect width="${SIZE}" height="${SIZE}" fill="#0c0e0d"/>` +
        `<path d="${SPEAKER}" fill="${colour}"/>` +
        glyph +
        `</svg>`
    );
}

function waves(colour: string): string {
    return (
        `<path d="M88 60a22 22 0 0 1 0 24" stroke="${colour}" stroke-width="8" stroke-linecap="round" fill="none"/>` +
        `<path d="M104 48a40 40 0 0 1 0 48" stroke="${colour}" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.75"/>`
    );
}
