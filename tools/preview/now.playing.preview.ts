import { writeFileSync } from 'node:fs';

import { nowPlayingSvg } from '../../src/display/key.image.js';

/**
 * Draws every face a Now Playing key can have, side by side, so they can be LOOKED at.
 *
 * Tests can say that the bar got wider and that the cover is embedded through `xlink:href`. They
 * cannot say whether the shade is too heavy or the record too dark, and those are the things that
 * are wrong on a first attempt. Run it and open what it writes:
 *
 *   node --experimental-strip-types tools/preview/now.playing.preview.ts
 */
const cover =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a4b8c"/><stop offset="1" stop-color="#c2564a"/></linearGradient></defs><rect width="144" height="144" fill="url(#g)"/><circle cx="72" cy="62" r="34" fill="#ffffff" fill-opacity="0.22"/></svg>',
    );

const faces = [
    { name: 'playing a track', face: { cover, step: 13, stale: false, shade: true } },
    { name: 'no cover to be had', face: { step: 26, stale: false, shade: true } },
    { name: 'a stream, so no bar', face: { cover, stale: false, shade: true } },
    { name: 'cover only', face: { cover, stale: false, shade: false } },
    { name: 'stale', face: { cover, step: 13, stale: true, shade: true } },
];

const inner = (svg: string): string => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const text = (x: number, y: number, body: string, size: number, fill: string, weight = 400, opacity = 1): string =>
    `<text x="${x}" y="${y}" fill="${fill}" opacity="${opacity}" font-family="-apple-system, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="middle">${body}</text>`;

const cells = faces
    .map(({ name, face }, index) => {
        const x = 24 + index * 168;
        // The Stream Deck app draws the title itself, over the shade, so it is drawn here too.
        const title = face.shade ? text(72, 116, 'Deadair', 12, '#ffffff', 600) + text(72, 132, 'Led Zeppelin', 11, '#ffffff', 400, 0.85) : '';
        return (
            `<g transform="translate(${x} 24)">` +
            `<rect x="-4" y="-4" width="152" height="152" rx="14" fill="#151515"/>` +
            `<svg x="0" y="0" width="144" height="144" viewBox="0 0 144 144">${inner(nowPlayingSvg(face))}${title}</svg>` +
            text(72, 178, name, 12, '#9a9a9a') +
            `</g>`
        );
    })
    .join('');

const width = 24 + faces.length * 168;
const out = 'artifacts/now-playing-preview.svg';
writeFileSync(
    out,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="210" viewBox="0 0 ${width} 210">` +
        `<rect width="${width}" height="210" fill="#0b0b0b"/>${cells}</svg>`,
);
console.log(`wrote ${out}`);
