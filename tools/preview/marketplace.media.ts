import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nowPlayingSvg } from '../../src/display/key.image.js';
import { inputSvg } from '../../src/display/input.image.js';
import { volumeSvg } from '../../src/display/volume.image.js';

/**
 * Draws the Marketplace listing's pictures from the plugin's OWN renderers.
 *
 * So the listing shows what a key actually draws rather than a mock-up that drifts from it. Run it
 * by hand when a key changes and commit what it writes:
 *
 *   pnpm preview tools/preview/marketplace.media.ts
 *
 * The covers here are abstract shapes and the records are made up, because a listing is no place
 * for somebody else's album art.
 */
/**
 * The listing wants 1920 x 960, but the pictures are DRAWN on a 1920 square.
 *
 * `qlmanage` renders an SVG into a square thumbnail and fits the artwork inside it, and what it does
 * with a 2:1 canvas is not worth reverse-engineering: the first attempt came out scaled and offset.
 * Drawing square means the render is one to one, and `sips` then crops the middle band, which is
 * deterministic. So the composition lives between `TOP` and `TOP + H`.
 */
const W = 1920;
const H = 960;
const CANVAS = 1920;
const TOP = (CANVAS - H) / 2;

/** A stand-in cover, so the composition is what shows rather than a real record's artwork. */
const cover = (from: string, to: string, seed: number): string =>
    'data:image/svg+xml,' +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">` +
            `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
            `<rect width="144" height="144" fill="url(#g)"/>` +
            `<circle cx="${40 + seed * 11}" cy="${52 + seed * 7}" r="${26 + seed * 4}" fill="#ffffff" fill-opacity="0.2"/>` +
            `<circle cx="${110 - seed * 9}" cy="${104 - seed * 5}" r="${18 + seed * 3}" fill="#000000" fill-opacity="0.18"/>` +
            `</svg>`,
    );

const inner = (svg: string): string => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

/** One Stream Deck key, drawn at `size` with the app's rounded corners and its title over the shade. */
function key(x: number, y: number, size: number, svg: string, lines: [string, string?] = ['', undefined]): string {
    const scale = size / 144;
    const title =
        lines[0] === ''
            ? ''
            : `<text x="72" y="114" fill="#fff" font-family="-apple-system, Helvetica, sans-serif" font-size="13" font-weight="600" text-anchor="middle">${lines[0]}</text>` +
              (lines[1] === undefined
                  ? ''
                  : `<text x="72" y="131" fill="#fff" opacity="0.85" font-family="-apple-system, Helvetica, sans-serif" font-size="11.5" text-anchor="middle">${lines[1]}</text>`);
    return (
        `<g transform="translate(${x} ${y})">` +
        `<rect width="${size}" height="${size}" rx="${18 * scale}" fill="#101010"/>` +
        `<svg x="0" y="0" width="${size}" height="${size}" viewBox="0 0 144 144"><clipPath id="c${x}${y}"><rect width="144" height="144" rx="18"/></clipPath><g clip-path="url(#c${x}${y})">${inner(svg)}${title}</g></svg>` +
        `</g>`
    );
}

function caption(text: string, sub: string): string {
    return (
        `<text x="${W / 2}" y="${H - 190}" fill="#ffffff" font-family="-apple-system, Helvetica, sans-serif" font-size="52" font-weight="600" text-anchor="middle">${text}</text>` +
        `<text x="${W / 2}" y="${H - 136}" fill="#9aa3a8" font-family="-apple-system, Helvetica, sans-serif" font-size="30" text-anchor="middle">${sub}</text>`
    );
}

const frame = (body: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16181a"/><stop offset="1" stop-color="#0a0b0c"/></linearGradient></defs>` +
    `<rect width="${CANVAS}" height="${CANVAS}" fill="url(#bg)"/>` +
    `<g transform="translate(0 ${TOP})">${body}</g></svg>`;

const SIZE = 200;
const GAP = 26;

/** A row of keys, centred. */
const row = (y: number, cells: string[]): string => {
    const width = cells.length * SIZE + (cells.length - 1) * GAP;
    return cells.map((cell, i) => cell.replace('translate(0 0)', `translate(${(W - width) / 2 + i * (SIZE + GAP)} ${y})`)).join('');
};

const at = (svg: string, lines: [string, string?] = ['', undefined]): string => key(0, 0, SIZE, svg, lines);

const purple = cover('#6d4a8f', '#c2564a', 1);
const teal = cover('#1f6f78', '#2e7bd6', 2);

const pictures: Record<string, string> = {
    'gallery-1-now-playing.svg': frame(
        row(250, [
            at(nowPlayingSvg({ cover: purple, step: 13, stale: false, shade: true }), ['Deadair', 'Led Zeppelin']),
            at(nowPlayingSvg({ cover: teal, step: 29, stale: false, shade: true }), ['Ágætis byrjun', 'Sigur Rós']),
            at(nowPlayingSvg({ cover: purple, stale: false, shade: false })),
        ]) + caption('What is playing, on the key', 'The cover, the two lines the player says to use, and how far through it is'),
    ),
    'gallery-2-transport.svg': frame(
        row(250, [
            at(nowPlayingSvg({ cover: teal, step: 20, stale: false, shade: true }), ['Perfect', 'Ed Sheeran']),
            at('<svg width="144" height="144"><rect width="144" height="144" fill="#0c0e0d"/><path d="M52 36v72l58-36z" fill="#fff"/></svg>'),
            at(
                '<svg width="144" height="144"><rect width="144" height="144" fill="#0c0e0d"/><path d="M40 36h20v72H40zM84 36h20v72H84z" fill="#fff"/></svg>',
            ),
            at(
                '<svg width="144" height="144"><rect width="144" height="144" fill="#0c0e0d"/><path d="M34 36 92 72 34 108zM100 36h14v72h-14z" fill="#fff"/></svg>',
            ),
        ]) + caption('Play, pause and skip', 'On a radio stream, the skip keys say so rather than pretending'),
    ),
    'gallery-3-volume.svg': frame(
        row(250, [
            at(volumeSvg('up'), ['42']),
            at(volumeSvg('down'), ['42']),
            at(volumeSvg('mute'), ['Muted']),
            at(nowPlayingSvg({ cover: purple, step: 8, stale: false, shade: true }), ['Office', 'NAD M10 V2']),
        ]) + caption('The volume, on a key or a dial', 'Hold to run, press the dial to mute, or turn it on a Stream Deck +'),
    ),
    'gallery-4-presets.svg': frame(
        row(250, [
            at(nowPlayingSvg({ cover: teal, stale: false, shade: true }), ['Serenity']),
            at(nowPlayingSvg({ cover: purple, stale: false, shade: true }), ['Morning Jazz']),
            at(inputSvg({ active: true, stale: false }), ['HDMI ARC']),
            at(inputSvg({ active: false, stale: false }), ['Turntable']),
        ]) + caption('Presets and inputs', 'Each preset with its own artwork, and inputs that light up while they play'),
    ),
    'thumbnail.svg': frame(
        row(250, [
            at(nowPlayingSvg({ cover: purple, step: 13, stale: false, shade: true }), ['Deadair', 'Led Zeppelin']),
            at(volumeSvg('up'), ['42']),
        ]) + caption('BluOS', 'Control a Bluesound or NAD player from your Stream Deck'),
    ),
};

mkdirSync('marketplace/media', { recursive: true });
for (const [name, svg] of Object.entries(pictures)) writeFileSync(`marketplace/media/${name}`, svg);
console.log(`wrote ${Object.keys(pictures).length} pictures into marketplace/media/`);

/**
 * Turns each SVG into the PNG the Maker Console actually takes.
 *
 * macOS's own two tools, because nothing in this toolchain reads SVG and a rasteriser would be a
 * large dependency for four pictures: `qlmanage` draws the SVG, which it does SQUARE and padded, and
 * `sips` crops the middle back to 1920 x 960. It is macOS-only, and that is fine for a step somebody
 * runs by hand before uploading.
 */
if (process.platform !== 'darwin') {
    console.log('Not macOS, so the PNGs were not made. Export the SVGs at 1920 x 960 before uploading.');
    process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), 'bluos-media-'));
try {
    for (const name of Object.keys(pictures)) {
        const png = name.replace(/\.svg$/, '.png');
        execFileSync('qlmanage', ['-t', '-s', String(CANVAS), '-o', scratch, `marketplace/media/${name}`], { stdio: 'ignore' });
        execFileSync('sips', ['-c', String(H), String(W), join(scratch, `${name}.png`), '--out', join(scratch, png)], { stdio: 'ignore' });
        renameSync(join(scratch, png), `marketplace/media/${png}`);
        console.log(`  ${png}`);
    }
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
