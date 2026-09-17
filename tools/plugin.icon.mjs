import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

/**
 * Draws the plugin's icon, which Elgato requires as a PNG at 256 and 512 pixels.
 *
 * Drawn here rather than rasterised from the SVG beside it, because nothing in this toolchain reads
 * SVG: there is no poppler, no ImageMagick, and `sips` does not decode it. The mark is a record —
 * a disc, a label and a spindle hole — which is a handful of circles and so needs no path renderer
 * at all. Run it by hand when the mark changes and commit what it writes.
 */

const INK = [0x2e, 0x7b, 0xd6]; // the disc
const LABEL = [0xf5, 0xf7, 0xfa]; // the paper label
const GROOVE = [0x1d, 0x4e, 0x8a]; // the rings cut into it

/** One pixel's colour, supersampled 4x4 so the circles do not stair-step. */
function sample(x, y, size) {
    let r = 0,
        g = 0,
        b = 0,
        a = 0;
    for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
            const px = (x + (sx + 0.5) / 4) / size - 0.5;
            const py = (y + (sy + 0.5) / 4) / size - 0.5;
            const d = Math.hypot(px, py);
            let c = null;
            if (d <= 0.06)
                c = null; // the spindle hole, left transparent
            else if (d <= 0.2) c = LABEL;
            else if (d <= 0.47) c = (d > 0.235 && d < 0.25) || (d > 0.29 && d < 0.305) || (d > 0.345 && d < 0.36) ? GROOVE : INK;
            if (c) {
                r += c[0];
                g += c[1];
                b += c[2];
                a += 255;
            }
        }
    }
    const n = 16;
    return a === 0 ? [0, 0, 0, 0] : [Math.round(r / (a / 255)), Math.round(g / (a / 255)), Math.round(b / (a / 255)), Math.round(a / n)];
}

function crc32(buf) {
    let c = ~0;
    for (const byte of buf) {
        c ^= byte;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
}

function chunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
}

function png(size) {
    // One filter byte (0, "None") then RGBA per row, which is what the IDAT stream is.
    const raw = Buffer.alloc(size * (1 + size * 4));
    for (let y = 0; y < size; y++) {
        let at = y * (1 + size * 4) + 1;
        for (let x = 0; x < size; x++) {
            const [r, g, b, a] = sample(x, y, size);
            raw[at++] = r;
            raw[at++] = g;
            raw[at++] = b;
            raw[at++] = a;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // truecolour with alpha
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

const dir = 'com.maroonedsoftware.bluos.sdPlugin/imgs/plugin';
writeFileSync(`${dir}/icon.png`, png(256));
writeFileSync(`${dir}/icon@2x.png`, png(512));
console.log('wrote icon.png (256) and icon@2x.png (512)');
