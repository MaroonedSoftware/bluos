import { describe, expect, it } from 'vitest';

import { attribute, child, children, decodeEntities, flag, number, parseXml, text, toNumber } from '../../src/bluos/xml.js';
import { AWKWARD_TEXT, SPEC_STATUS, SPEC_SYNC_STATUS } from '../fixtures/bluos.xml.js';

describe('decodeEntities', () => {
    it.each([
        ['Simon &amp; Garfunkel', 'Simon & Garfunkel'],
        ['Don&#39;t Think Twice', "Don't Think Twice"],
        ['caf&#233;', 'café'],
        ['&#x2014;', '—'],
        ['&lt;title1&gt;', '<title1>'],
        ['&quot;quoted&quot;', '"quoted"'],
        ['plain text', 'plain text'],
    ])('reads %s', (raw, expected) => {
        expect(decodeEntities(raw)).toBe(expected);
    });

    // The specification's own example prints `/Artwork?service=Deezer&songid=...` with a bare
    // ampersand, so a firmware may well send one. Leaving it alone is the only safe answer.
    it('leaves a bare ampersand as it found it', () => {
        expect(decodeEntities('/Artwork?service=Deezer&songid=x')).toBe('/Artwork?service=Deezer&songid=x');
    });

    it('leaves an entity it does not know rather than dropping it', () => {
        expect(decodeEntities('a &nosuch; b')).toBe('a &nosuch; b');
    });

    it('leaves a code point that is not one', () => {
        expect(decodeEntities('&#1114113;')).toBe('&#1114113;');
    });
});

describe('parseXml', () => {
    it('reads the specification’s own Status example', () => {
        const status = parseXml(SPEC_STATUS);
        expect(status?.name).toBe('status');
        expect(attribute(status, 'etag')).toBe('4e266c9fbfba6d13d1a4d6ff4bd2e1e6');
        expect(text(status, 'title1')).toBe('Perfect');
        expect(text(status, 'title3')).toBe('÷ (Deluxe)');
        expect(number(status, 'totlen')).toBe(263);
        expect(text(status, 'image')).toBe('/Artwork?service=Deezer&songid=Deezer%3A142986206');
    });

    // `<sleep/>` is in the specification's example, and a self-closing tag that swallowed the rest
    // of the document would take every field after it with it.
    it('reads a self-closing tag without losing what follows', () => {
        const status = parseXml(SPEC_STATUS);
        expect(child(status, 'sleep')).toBeDefined();
        expect(text(status, 'sleep')).toBeUndefined();
        expect(text(status, 'song')).toBe('19');
        expect(number(status, 'secs')).toBe(35);
    });

    it('reads attributes and repeated children', () => {
        const sync = parseXml(SPEC_SYNC_STATUS);
        expect(attribute(sync, 'name')).toBe('PULSE-0278');
        expect(attribute(sync, 'mac')).toBe('90:56:82:9F:02:78');
        expect(children(sync, 'slave')).toHaveLength(2);
        expect(child(sync, 'master')?.text).toBe('192.168.1.100');
    });

    // The case that breaks a regular expression: a CDATA section containing a closing tag.
    it('takes CDATA verbatim, closing tag and all', () => {
        const status = parseXml(AWKWARD_TEXT);
        expect(text(status, 'title2')).toBe('Parsley, Sage </title1> Rosemary & Thyme');
        expect(text(status, 'title1')).toBe('Simon & Garfunkel');
        expect(text(status, 'title3')).toBe('Scarborough Fair — Canticle — café');
    });

    it('skips the declaration and comments', () => {
        expect(parseXml(AWKWARD_TEXT)?.name).toBe('status');
    });

    it('never throws on something that is not a player’s answer', () => {
        for (const junk of ['', '   ', 'not xml at all', '<html><body>404</body></html>', '<status', '<status><title1>half']) {
            expect(() => parseXml(junk)).not.toThrow();
        }
    });

    // A response cut off mid-flight still names the state, which is more use to a key than nothing.
    it('returns what it read from a truncated document', () => {
        const status = parseXml('<status etag="x"><state>play</state><title1>Half');
        expect(attribute(status, 'etag')).toBe('x');
        expect(text(status, 'state')).toBe('play');
    });

    it('does not mistake a > inside an attribute for the end of a tag', () => {
        const root = parseXml('<status label="a > b"><state>play</state></status>');
        expect(attribute(root, 'label')).toBe('a > b');
        expect(text(root, 'state')).toBe('play');
    });
});

describe('the small readers', () => {
    it('treats an empty element as absent, which is how BluOS says "nothing here"', () => {
        const root = parseXml('<status><syncStat></syncStat><sleep/><name>  </name></status>');
        expect(text(root, 'syncStat')).toBeUndefined();
        expect(text(root, 'sleep')).toBeUndefined();
        expect(text(root, 'name')).toBeUndefined();
    });

    it.each([
        ['1', true],
        ['0', false],
        ['true', true],
        ['false', false],
        ['', undefined],
        ['maybe', undefined],
        [undefined, undefined],
    ])('reads the flag %s', (raw, expected) => {
        expect(flag(raw)).toBe(expected);
    });

    it.each([
        ['42', 42],
        ['-1', -1],
        ['-62.9', -62.9],
        ['', undefined],
        ['nope', undefined],
        [undefined, undefined],
    ])('reads the number %s', (raw, expected) => {
        expect(toNumber(raw)).toBe(expected);
    });
});
