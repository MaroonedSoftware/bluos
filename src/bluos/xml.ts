/**
 * Just enough XML to read what a BluOS player says.
 *
 * BluOS answers XML and offers nothing else: the word JSON appears nowhere in the v1.7
 * specification, there is no Accept header and no format parameter. So a parser is not optional,
 * and the only question is which one.
 *
 * It is written here rather than taken from `fast-xml-parser` for two reasons. Every dependency is
 * inlined permanently into a signed installer, and version 5 of that package is no longer
 * dependency-free. And its option surface, above all the rule that one child is an object and two
 * are an array, means writing a normalising layer anyway, which is the code the dependency was
 * supposed to save.
 *
 * It is emphatically not a regular expression. Music metadata is the worst case for one: an
 * ampersand arrives as `&amp;`, an apostrophe often as `&#39;`, `Sigur Rós` has to survive, and a
 * CDATA section may legally contain `</title1>`, which breaks a non-greedy match outright.
 *
 * What it handles, and nothing more: elements, nesting, self-closing tags (the specification's own
 * example has `<sleep/>`), quoted attributes, text, CDATA, the five predefined entities and numeric
 * character references, and skipping the declaration and comments. BluOS emits no namespaces and no
 * DTDs, so neither is understood.
 */

export interface XmlElement {
    readonly name: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly children: readonly XmlElement[];
    /** The element's own text, with CDATA and entities resolved. Text inside children is theirs. */
    readonly text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Resolves the entities a BluOS response can carry.
 *
 * An unknown entity is left exactly as it was rather than dropped, because a track really called
 * "&foo;" should read as itself rather than disappear, and because a firmware inventing an entity
 * should degrade to something visible rather than to nothing.
 */
export function decodeEntities(text: string): string {
    if (!text.includes('&')) return text;
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
        if (body.startsWith('#x') || body.startsWith('#X')) {
            const code = Number.parseInt(body.slice(2), 16);
            return Number.isNaN(code) ? whole : safeFromCodePoint(code, whole);
        }
        if (body.startsWith('#')) {
            const code = Number.parseInt(body.slice(1), 10);
            return Number.isNaN(code) ? whole : safeFromCodePoint(code, whole);
        }
        return ENTITIES[body] ?? whole;
    });
}

/** A code point that is not one, such as `&#1114112;`, is left as it was written rather than thrown over. */
function safeFromCodePoint(code: number, whole: string): string {
    if (code < 0 || code > 0x10ffff) return whole;
    try {
        return String.fromCodePoint(code);
    } catch {
        return whole;
    }
}

interface Building {
    name: string;
    attributes: Record<string, string>;
    children: XmlElement[];
    text: string;
}

/**
 * Reads a document and returns its root element, or `undefined` when there is not one.
 *
 * Never throws. A response that is truncated, empty, or HTML from something that is not a player at
 * all has to end as a reading the keys can refuse, not as an exception from inside a poll loop.
 */
export function parseXml(source: string): XmlElement | undefined {
    const stack: Building[] = [];
    let root: XmlElement | undefined;
    let at = 0;

    const push = (text: string): void => {
        const top = stack[stack.length - 1];
        if (top) top.text += text;
    };

    while (at < source.length) {
        const open = source.indexOf('<', at);
        if (open === -1) {
            push(decodeEntities(source.slice(at)));
            break;
        }
        if (open > at) push(decodeEntities(source.slice(at, open)));

        // CDATA is taken verbatim: entities inside it are literal text, which is the whole point.
        if (source.startsWith('<![CDATA[', open)) {
            const end = source.indexOf(']]>', open + 9);
            push(source.slice(open + 9, end === -1 ? source.length : end));
            at = end === -1 ? source.length : end + 3;
            continue;
        }
        if (source.startsWith('<!--', open)) {
            const end = source.indexOf('-->', open + 4);
            at = end === -1 ? source.length : end + 3;
            continue;
        }
        // The `<?xml ... ?>` declaration, and any other processing instruction or doctype.
        if (source.startsWith('<?', open) || source.startsWith('<!', open)) {
            const end = source.indexOf('>', open + 2);
            at = end === -1 ? source.length : end + 1;
            continue;
        }

        const close = findTagEnd(source, open);
        if (close === -1) break;
        const inner = source.slice(open + 1, close);
        at = close + 1;

        if (inner.startsWith('/')) {
            const done = stack.pop();
            if (!done) continue;
            const element = seal(done);
            const parent = stack[stack.length - 1];
            if (parent) parent.children.push(element);
            else root ??= element;
            continue;
        }

        const selfClosing = inner.endsWith('/');
        const body = selfClosing ? inner.slice(0, -1) : inner;
        const element = startTag(body);
        if (selfClosing) {
            const parent = stack[stack.length - 1];
            if (parent) parent.children.push(seal(element));
            else root ??= seal(element);
        } else {
            stack.push(element);
        }
    }

    // A document that stopped mid-element still yields what was read, because a truncated response
    // that names the state is more use to a key than nothing at all.
    while (stack.length > 0) {
        const done = stack.pop() as Building;
        const element = seal(done);
        const parent = stack[stack.length - 1];
        if (parent) parent.children.push(element);
        else root ??= element;
    }
    return root;
}

/** The `>` that ends a tag, skipping any inside a quoted attribute value. */
function findTagEnd(source: string, open: number): number {
    let quote: string | undefined;
    for (let i = open + 1; i < source.length; i++) {
        const ch = source[i] as string;
        if (quote) {
            if (ch === quote) quote = undefined;
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') return i;
    }
    return -1;
}

function startTag(body: string): Building {
    const match = /^\s*([^\s/>]+)/.exec(body);
    const name = match?.[1] ?? '';
    const attributes: Record<string, string> = {};
    const rest = body.slice((match?.index ?? 0) + (match?.[0].length ?? 0));
    const attribute = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let found: RegExpExecArray | null;
    while ((found = attribute.exec(rest)) !== null) {
        attributes[found[1] as string] = decodeEntities(found[3] ?? found[4] ?? found[5] ?? '');
    }
    return { name, attributes, children: [], text: '' };
}

function seal(building: Building): XmlElement {
    return { name: building.name, attributes: building.attributes, children: building.children, text: building.text };
}

/** The first child with this name, or `undefined`. Case-sensitive, as BluOS is. */
export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
    return element?.children.find(candidate => candidate.name === name);
}

/** Every child with this name, in document order. */
export function children(element: XmlElement | undefined, name: string): readonly XmlElement[] {
    return element?.children.filter(candidate => candidate.name === name) ?? [];
}

/**
 * The trimmed text of a named child, or `undefined` when it is absent OR empty.
 *
 * Empty counting as absent is deliberate and is what the rest of the reading rests on: BluOS sends
 * `<sleep/>` and `<syncStat></syncStat>` for "nothing here", and a key that told the difference
 * between those and a missing element would be drawing a distinction the player does not make.
 */
export function text(element: XmlElement | undefined, name: string): string | undefined {
    const found = child(element, name)?.text.trim();
    return found === undefined || found === '' ? undefined : found;
}

/** A named child read as a number, or `undefined` when it is absent or not one. */
export function number(element: XmlElement | undefined, name: string): number | undefined {
    return toNumber(text(element, name));
}

/** An attribute, or `undefined` when it is absent or empty. */
export function attribute(element: XmlElement | undefined, name: string): string | undefined {
    const found = element?.attributes[name]?.trim();
    return found === undefined || found === '' ? undefined : found;
}

/**
 * A string read as a number, or `undefined` when it is not one.
 *
 * Empty and whitespace are rejected explicitly, because `Number('')` is 0 rather than NaN. Without
 * that line an empty `<volume></volume>` reads as a volume of zero instead of as a volume nobody
 * knows, and a key would confidently draw silence.
 */
export function toNumber(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A BluOS flag, which is `1` or `0` in most places and `true` or `false` in a few.
 *
 * Anything else is `undefined` rather than false, so a caller decides what an unreadable flag
 * means for it. `canSeek` reads `1`, `canMovePlayback` reads `true`, and both are in the same
 * response.
 */
export function flag(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    const normalised = value.trim().toLowerCase();
    if (normalised === '1' || normalised === 'true') return true;
    if (normalised === '0' || normalised === 'false') return false;
    return undefined;
}
