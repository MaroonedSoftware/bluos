import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Draws the plugin's icon, which Elgato requires as a PNG at 256 and 512 pixels, and its category icon.
 *
 * The plugin's name, "BluOS Remote", with the BluOS "B" mark standing in for the letter. "Remote"
 * is what keeps the icon from reading as an official BluOS product. The SVG written beside the
 * PNGs is the source; `qlmanage` rasterises it, as it does the Marketplace pictures, and `sips`
 * would not. Run it by hand when the mark changes and commit what it writes.
 *
 * The B is traced from the mark at 240 pixels: one solid stroke, two bowls that pinch to a point on
 * the right where the middle bar meets them. The trace matched the original's pixels at 93 percent
 * at a stroke of 10.5; it is drawn heavier here so it carries the same weight as the type beside it.
 *
 * The category icon is the B alone, white, because Elgato draws it as a 20-pixel silhouette where a
 * word would not read. It is an SVG the app scales itself, so it needs no rendering.
 */

const NAVY = '#0B1B33';
const SKY = '#7FB3FF'; // "Remote", lighter than the B so the name reads as one word and a qualifier
const WHITE = '#FFFFFF';

/** The B's centreline, in the 240-pixel frame it was traced in. Its stem is x 62.5, its bars y 54.5 and 185.5. */
const B_PATH =
    'M176 120 C165 107 152 98 131 97.5 H90 C72 97.5 62.5 90 62.5 74 V54.5 H134 C159 54.5 179 72 179 95 C179 106 178 114 176 120 Z ' +
    'M176 120 C165 133 152 142 131 142.5 H90 C72 142.5 62.5 150 62.5 166 V185.5 H134 C159 185.5 179 168 179 145 C179 134 178 126 176 120 Z';

const FONT = 'Helvetica Neue, Helvetica, Arial, sans-serif';
const TYPE = 64; // the word's font size
const CAP = TYPE * 0.714; // Helvetica's cap height
const BASELINE = 126; // with "Remote" 50 below, the pair sits centred on the tile
const B_STROKE = 19; // in the trace's frame, so roughly the type's stem once scaled
const B_SCALE = CAP / (131 + B_STROKE);
const B_WIDTH = (179 - 62.5 + B_STROKE) * B_SCALE;
const LU_OS = TYPE * 2.2; // "luOS" measured at about 2.2 em in Helvetica Neue
const GAP = 3;
const LEFT = (256 - (B_WIDTH + GAP + LU_OS)) / 2;

const b =
    `<g transform="translate(${LEFT + (B_STROKE / 2) * B_SCALE} ${BASELINE - CAP + (B_STROKE / 2) * B_SCALE}) scale(${B_SCALE}) translate(-62.5 -54.5)">` +
    `<path d="${B_PATH}" fill="none" stroke="${WHITE}" stroke-width="${B_STROKE}" stroke-linejoin="miter" stroke-miterlimit="2"/></g>`;

/** `qlmanage` draws an SVG at its declared size, so each PNG is rendered from one declared at that size. */
const svg = size =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}">` +
    `<rect width="256" height="256" rx="52" fill="${NAVY}"/>` +
    b +
    `<text x="${LEFT + B_WIDTH + GAP}" y="${BASELINE}" font-family="${FONT}" font-size="${TYPE}" font-weight="500" fill="${WHITE}" letter-spacing="-1">luOS</text>` +
    `<text x="128" y="${BASELINE + 50}" text-anchor="middle" font-family="${FONT}" font-size="38" font-weight="400" fill="${SKY}" letter-spacing="0.5">Remote</text>` +
    `</svg>\n`;

/** Heavier again than in the icon, so the stroke is about two pixels at the size the app draws it. */
const CATEGORY_STROKE = 18;
const category =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="40.75 40 160 160" width="20" height="20">` +
    `<path d="${B_PATH}" fill="none" stroke="#fff" stroke-width="${CATEGORY_STROKE}" stroke-linejoin="miter" stroke-miterlimit="2"/></svg>\n`;

const dir = 'com.maroonedsoftware.bluos.sdPlugin/imgs/plugin';
writeFileSync(`${dir}/icon.svg`, svg(256));
writeFileSync(`${dir}/category-icon.svg`, category);

const scratch = mkdtempSync(join(tmpdir(), 'icon-'));
try {
    for (const [size, name] of [
        [256, 'icon.png'],
        [512, 'icon@2x.png'],
    ]) {
        writeFileSync(join(scratch, 'icon.svg'), svg(size));
        execFileSync('qlmanage', ['-t', '-s', String(size), '-o', scratch, join(scratch, 'icon.svg')], { stdio: 'ignore' });
        renameSync(join(scratch, 'icon.svg.png'), `${dir}/${name}`);
    }
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
console.log('wrote category-icon.svg, icon.svg, icon.png (256) and icon@2x.png (512)');
