import { attribute, children, parseXml, toNumber } from './xml.js';

/** One preset, as the player lists it. */
export type Preset = {
    /** What `/Preset?id=` takes. Not necessarily sequential: a player can have 1, 2, 3, 5 and 8. */
    id: number;
    name: string;
    /** Its artwork, as the player wrote it: absolute, or an `/Artwork` path to resolve against it. */
    image?: string;
};

/** A player's presets, and the id of the list they came from. */
export interface PresetList {
    /**
     * Changes whenever the presets change, and `/Status` carries the same value as `<prid>`.
     *
     * That is what lets a preset key stay current without asking for the list on a timer: the
     * long-poll it already has says when the list has moved.
     */
    prid?: string;
    presets: Preset[];
}

/**
 * Reads `/Presets`. Returns `undefined` when the body is not one.
 *
 * A preset with no usable id is dropped rather than guessed at, because pressing a key that loads
 * the wrong preset is worse than a key that says it has none.
 */
export function readPresets(body: string): PresetList | undefined {
    const root = parseXml(body);
    if (root?.name !== 'presets') return undefined;
    const presets: Preset[] = [];
    for (const element of children(root, 'preset')) {
        const id = toNumber(attribute(element, 'id'));
        if (id === undefined || !Number.isInteger(id)) continue;
        const image = attribute(element, 'image');
        presets.push({ id, name: attribute(element, 'name') ?? `Preset ${id}`, ...(image === undefined ? {} : { image }) });
    }
    const prid = attribute(root, 'prid');
    return { ...(prid === undefined ? {} : { prid }), presets };
}
