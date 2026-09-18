import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readFileSync as read } from 'node:fs';

import { ACTION_IDS, ENCODERS, PLUGIN, STRIP, VOLUME_DIAL } from '../src/actions/action.ids.js';

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
    PropertyInspectorPath: string;
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

    it('has the settings panel it names, loading the script the build writes beside it', () => {
        const page = readFileSync(join(plugin, manifest.PropertyInspectorPath), 'utf8');
        expect(page).toContain('<script src="player.js"></script>');
    });

    it('puts the dial actions on an encoder and every other action on a key', () => {
        for (const action of manifest.Actions) {
            expect(action.Controllers ?? ['Keypad'], action.UUID).toEqual(action.UUID in ENCODERS ? ['Encoder'] : ['Keypad']);
        }
    });

    it('gives each dial action the layout the code draws into', () => {
        for (const [uuid, layout] of Object.entries(ENCODERS)) {
            expect(manifest.Actions.find(action => action.UUID === uuid)?.Encoder?.layout, uuid).toBe(layout);
        }
    });
});

/**
 * The frame interface each dial layout is filled from, by the layout it fills.
 *
 * A key passed to `setFeedback` that the layout never declared fails SILENTLY: nothing errors, and
 * nothing draws. So each layout is checked against the keys the code actually sends, read out of
 * the source, rather than against a list written twice and left to drift.
 */
const FRAMES: Record<string, { file: string; frame: string }> = {
    [VOLUME_DIAL]: { file: '../src/display/dial.face.ts', frame: 'DialFrame' },
    [STRIP]: { file: '../src/display/strip.face.ts', frame: 'StripFrame' },
};

/** The top-level field names of an interface, read to its closing brace rather than the first `}`. */
function fieldsOf(file: string, name: string): string[] {
    const source = read(resolve(import.meta.dirname, file), 'utf8');
    const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? '';
    return [...body.matchAll(/^ {4}(\w+)\??:/gm)].map(match => match[1] as string);
}

for (const [uuid, layoutPath] of Object.entries(ENCODERS)) {
    describe(`the layout for ${uuid.split('.').at(-1)}`, () => {
        const layout = JSON.parse(readFileSync(join(plugin, layoutPath), 'utf8')) as Layout;
        const source = FRAMES[uuid];

        it('declares every item the code sends feedback to', () => {
            expect(source, `no frame is registered for ${uuid}`).toBeDefined();
            const sent = fieldsOf(source!.file, source!.frame);
            expect(sent.length).toBeGreaterThan(0);
            const declared = layout.items.map(item => item.key);
            for (const key of sent) expect(declared, `${layoutPath} has no "${key}" for setFeedback to fill`).toContain(key);
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
}
