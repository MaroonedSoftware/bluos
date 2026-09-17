import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ACTION_IDS, PLUGIN, VOLUME_DIAL } from '../src/actions/action.ids.js';

// `streamdeck validate` checks much of this too, but it fetches the manifest's URLs first and so
// needs the network, which a test run does not have. These are the parts that break without anybody
// editing the manifest: an image renamed under it, an action whose id stops matching the plugin's,
// a layout key the code sends feedback to that the layout never declared.
const plugin = resolve(import.meta.dirname, '../com.maroonedsoftware.bluos.sdPlugin');

interface State {
    Image: string;
}
interface Action {
    UUID: string;
    Icon: string;
    States: State[];
    Controllers?: string[];
    Encoder?: { layout?: string };
}
interface Manifest {
    UUID: string;
    Version: string;
    Icon: string;
    CategoryIcon: string;
    CodePath: string;
    Nodejs: { Version: string };
    Actions: Action[];
}
interface Layout {
    id: string;
    items: { key: string; type: string; rect: [number, number, number, number]; zOrder?: number }[];
}

const manifest = JSON.parse(readFileSync(join(plugin, 'manifest.json'), 'utf8')) as Manifest;
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string };

/** A PNG's pixel width, read off its header. */
function pngWidth(path: string): number {
    return readFileSync(path).readUInt32BE(16);
}

/** Whether Stream Deck can find the image a manifest path names: an SVG, or a PNG with its @2x beside it. */
function imageExists(path: string): boolean {
    const base = join(plugin, path);
    return existsSync(`${base}.svg`) || (existsSync(`${base}.png`) && existsSync(`${base}@2x.png`));
}

describe('the plugin manifest', () => {
    it('declares exactly the actions the code names', () => {
        expect(manifest.Actions.map(action => action.UUID).sort()).toEqual([...ACTION_IDS].sort());
    });

    it('names every action under the plugin’s own id', () => {
        expect(manifest.UUID).toBe(PLUGIN);
        for (const action of manifest.Actions) {
            expect(action.UUID.startsWith(`${manifest.UUID}.`), action.UUID).toBe(true);
        }
    });

    it('has every image it names', () => {
        const paths = [manifest.CategoryIcon, ...manifest.Actions.flatMap(action => [action.Icon, ...action.States.map(state => state.Image)])];
        for (const path of paths) {
            expect(imageExists(path), path).toBe(true);
        }
    });

    it('has the plugin icon as a PNG at the two sizes the store asks for', () => {
        expect(pngWidth(join(plugin, `${manifest.Icon}.png`))).toBe(256);
        expect(pngWidth(join(plugin, `${manifest.Icon}@2x.png`))).toBe(512);
    });

    it('states the package’s version with a build number after it', () => {
        expect(manifest.Version).toBe(`${pkg.version}.0`);
    });

    it('runs the bundle the build writes, on a Node the Stream Deck app offers', () => {
        expect(manifest.CodePath).toBe('bin/plugin.js');
        expect(['20', '24']).toContain(manifest.Nodejs.Version);
    });

    it('puts the volume dial on an encoder and every other action on a key', () => {
        for (const action of manifest.Actions) {
            expect(action.Controllers ?? ['Keypad'], action.UUID).toEqual(action.UUID === VOLUME_DIAL ? ['Encoder'] : ['Keypad']);
        }
    });
});

describe('the dial’s layout', () => {
    const named = manifest.Actions.find(action => action.UUID === VOLUME_DIAL)?.Encoder?.layout;
    const layout = JSON.parse(readFileSync(join(plugin, named!), 'utf8')) as Layout;

    it('is the file the manifest names', () => {
        expect(named).toBe('layouts/volume.json');
    });

    // A key passed to `setFeedback` that the layout never declared fails silently: nothing errors,
    // and nothing draws. This is the test that catches the typo.
    it('declares every item the dial sends feedback to', () => {
        expect(layout.items.map(item => item.key).sort()).toEqual(['icon', 'indicator', 'title', 'value']);
    });

    it('keeps every item inside the 200 x 100 touch strip', () => {
        for (const { key, rect } of layout.items) {
            const [x, y, width, height] = rect;
            expect(x >= 0 && y >= 0 && x + width <= 200 && y + height <= 100, key).toBe(true);
        }
    });

    // Elgato's rule, and it fails by drawing the wrong thing rather than by complaining.
    it('never overlaps two items on the same layer', () => {
        for (const a of layout.items) {
            for (const b of layout.items) {
                if (a === b || (a.zOrder ?? 0) !== (b.zOrder ?? 0)) continue;
                const overlaps =
                    a.rect[0] < b.rect[0] + b.rect[2] &&
                    b.rect[0] < a.rect[0] + a.rect[2] &&
                    a.rect[1] < b.rect[1] + b.rect[3] &&
                    b.rect[1] < a.rect[1] + a.rect[3];
                expect(overlaps, `${a.key} / ${b.key}`).toBe(false);
            }
        }
    });
});
