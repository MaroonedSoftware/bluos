import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** A decoded PNG: its size, and a way to read any pixel as red, green, blue and alpha. */
export interface Pixels {
    width: number;
    height: number;
    at(x: number, y: number): [number, number, number, number];
}

/** A byte the decoder knows is there, as a number rather than `number | undefined`. */
const byte = (buffer: Buffer, at: number): number => buffer[at] ?? 0;

/**
 * Decodes an 8-bit RGB or RGBA PNG, which is what `qlmanage` and `sips` write.
 *
 * Reading the header's width is not enough to check an icon: Elgato's review sent back a 256-pixel
 * PNG whose tile was drawn 219 pixels wide in the corner of a white canvas, and its header said 256.
 */
export function readPng(path: string): Pixels {
    const file = readFileSync(path);
    let width = 0;
    let height = 0;
    let channels = 0;
    const data: Buffer[] = [];
    for (let at = 8; at < file.length;) {
        const length = file.readUInt32BE(at);
        const type = file.toString('ascii', at + 4, at + 8);
        const body = file.subarray(at + 8, at + 8 + length);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            if (body[8] !== 8 || body[12] !== 0) throw new Error(`${path}: only 8-bit, non-interlaced PNGs are read`);
            const colour = body[9];
            if (colour === 2) channels = 3;
            else if (colour === 6) channels = 4;
            else throw new Error(`${path}: colour type ${colour} is not read`);
        }
        if (type === 'IDAT') data.push(body);
        at += 12 + length;
    }

    const raw = inflateSync(Buffer.concat(data));
    const stride = width * channels;
    const out = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const row = out.subarray(y * stride, (y + 1) * stride);
        const above = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
        for (let i = 0; i < stride; i++) {
            const left = i >= channels ? byte(row, i - channels) : 0;
            const up = byte(above, i);
            const corner = i >= channels ? byte(above, i - channels) : 0;
            let value = byte(line, i);
            if (filter === 1) value += left;
            else if (filter === 2) value += up;
            else if (filter === 3) value += (left + up) >> 1;
            else if (filter === 4) {
                const guess = left + up - corner;
                const a = Math.abs(guess - left);
                const b = Math.abs(guess - up);
                const c = Math.abs(guess - corner);
                value += a <= b && a <= c ? left : b <= c ? up : corner;
            }
            row[i] = value & 255;
        }
    }

    return {
        width,
        height,
        at(x, y) {
            const o = y * stride + x * channels;
            return [byte(out, o), byte(out, o + 1), byte(out, o + 2), channels === 4 ? byte(out, o + 3) : 255];
        },
    };
}
