import { describe, expect, it } from 'vitest';

import { addressFor, addressToAdopt, describeSettings, originFor } from '../src/player.settings.js';

describe('which player a key talks to', () => {
    it('uses its own address when it has one', () => {
        expect(addressFor({ address: '192.168.1.234' }, { defaultAddress: '192.168.1.1' })).toBe('192.168.1.234');
    });

    // The whole point of the global default: a freshly dragged key works before anybody opens it.
    it('falls back to the last player chosen anywhere', () => {
        expect(addressFor({}, { defaultAddress: '192.168.1.234' })).toBe('192.168.1.234');
    });

    it('has no player when neither is set', () => {
        expect(addressFor({}, {})).toBeUndefined();
        expect(originFor({}, {})).toBeUndefined();
    });

    it('treats an address of nothing but spaces as no address at all', () => {
        expect(addressFor({ address: '   ' }, { defaultAddress: '192.168.1.234' })).toBe('192.168.1.234');
        expect(addressFor({ address: '   ' }, { defaultAddress: '  ' })).toBeUndefined();
    });

    it('resolves a key’s address to a player', () => {
        expect(originFor({ address: '192.168.1.234' }, {})).toBe('http://192.168.1.234:11000');
    });

    it('has no player while what was typed is not an address', () => {
        expect(originFor({ address: 'ftp://nope' }, {})).toBeUndefined();
    });
});

// Writing the default into the key, rather than falling back at the moment of use, is what makes a
// key's settings describe the key truthfully and an exported profile carry the player it was using.
describe('adopting the default', () => {
    it('is what an unconfigured key should write into itself', () => {
        expect(addressToAdopt({}, { defaultAddress: '192.168.1.234' })).toBe('192.168.1.234');
    });

    it('is nothing once the key has its own, so it is written once and never again', () => {
        expect(addressToAdopt({ address: '192.168.1.99' }, { defaultAddress: '192.168.1.234' })).toBeUndefined();
    });

    it('is nothing when there is no default to adopt', () => {
        expect(addressToAdopt({}, {})).toBeUndefined();
        expect(addressToAdopt({}, { defaultAddress: '  ' })).toBeUndefined();
    });
});

describe('describeSettings', () => {
    it('names the player a log line is about', () => {
        expect(describeSettings({ address: '192.168.1.234' }, {})).toBe('http://192.168.1.234:11000');
    });

    it('says so when there is no player, and when what was typed is not one', () => {
        expect(describeSettings({}, {})).toBe('no player');
        expect(describeSettings({ address: 'ftp://nope' }, {})).toContain('does not read');
    });
});
