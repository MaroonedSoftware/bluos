import { describe, expect, it } from 'vitest';

import { readPresets } from '../../src/bluos/presets.reading.js';
import { SPEC_PRESETS } from '../fixtures/bluos.xml.js';

describe('readPresets', () => {
    it('reads the specification’s own example', () => {
        expect(readPresets(SPEC_PRESETS)).toEqual({
            prid: '2',
            presets: [
                { id: 6, name: 'Serenity', image: 'https://img.radioparadise.com/channels/0/42/cover_512x512/0.jpg' },
                // The entity in the attribute is decoded, so the path can be asked for as it stands.
                {
                    id: 7,
                    name: '1980s Alternative Rock Classics',
                    image: '/Artwork?service=Tidal&playlistimage=afacfc12-2403-4caf-a5c5-a2af28d811c8',
                },
            ],
        });
    });

    it('reads a player with no presets as an empty list, not as a failure', () => {
        expect(readPresets('<presets prid="9"/>')).toEqual({ prid: '9', presets: [] });
    });

    // Pressing a key that loads the wrong preset is worse than a key that says it has none.
    it('drops a preset with no usable id rather than guessing one', () => {
        expect(readPresets('<presets><preset name="Broken"/><preset id="x" name="Worse"/><preset id="3" name="Fine"/></presets>')?.presets).toEqual([
            { id: 3, name: 'Fine' },
        ]);
    });

    it('names a preset that has no name by its number', () => {
        expect(readPresets('<presets><preset id="4"/></presets>')?.presets[0]?.name).toBe('Preset 4');
    });

    it('refuses a body that is not a preset list', () => {
        expect(readPresets('<status/>')).toBeUndefined();
        expect(readPresets('nonsense')).toBeUndefined();
    });
});
