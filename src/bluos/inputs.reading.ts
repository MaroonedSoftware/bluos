import { attribute, children, parseXml, type XmlElement } from './xml.js';

/** A physical input a player can switch to. */
export type InputSource = {
    /** Stable across reads, and what `/Status` reports as `inputId` while it plays. */
    id: string;
    /** What the player calls it: "Optical Input", "HDMI ARC", and so on. */
    name: string;
    /**
     * What `/Play?url=` takes, DECODED.
     *
     * The player sends it already percent-encoded (`Capture%3Abluez%3Abluetooth`), and a query builder
     * encodes whatever it is given. Kept encoded, it would go out as `%253A` and the player would get
     * nonsense. So it is decoded here, once, and encoded exactly once on the way out.
     */
    url: string;
    /** The player's own icon for the input, as a path on the player. */
    image?: string;
    /** spdif, analog, arc, phono and so on. */
    type?: string;
    /** For an input on a BluOS HUB rather than on the player itself, the hub's name. */
    on?: string;
};

function sourceOf(element: XmlElement, on: string | undefined): InputSource | undefined {
    const id = attribute(element, 'id');
    const encoded = attribute(element, 'URL');
    const type = attribute(element, 'inputType');
    // Only physical inputs. The same list carries streaming services such as Spotify, which have no
    // inputType, and a key that says "Input" should not quietly start a cloud service.
    if (id === undefined || encoded === undefined || type === undefined) return undefined;
    let url: string;
    try {
        url = decodeURIComponent(encoded);
    } catch {
        return undefined;
    }
    const image = attribute(element, 'image');
    // The specification's own example wraps the name across lines; whatever whitespace arrives is one space.
    const name = (attribute(element, 'text') ?? id).replace(/\s+/g, ' ');
    return { id, name, url, type, ...(image === undefined ? {} : { image }), ...(on === undefined ? {} : { on }) };
}

/**
 * Reads `/RadioBrowse?service=Capture`: the player's own inputs, and those of any BluOS HUB it has.
 *
 * A hub's inputs arrive as `<remoteitem>` elements inside a `<category>` named for the hub.
 */
export function readInputs(body: string): InputSource[] | undefined {
    const root = parseXml(body);
    if (root?.name !== 'radiotime') return undefined;
    const found: InputSource[] = [];
    for (const item of children(root, 'item')) {
        const source = sourceOf(item, undefined);
        if (source) found.push(source);
    }
    for (const hub of children(root, 'category')) {
        const hubName = attribute(hub, 'text');
        for (const item of children(hub, 'remoteitem')) {
            const source = sourceOf(item, hubName);
            if (source) found.push(source);
        }
    }
    return found;
}
