import { describe, expect, it } from 'vitest';

import { describePlayer, readSyncStatus } from '../../src/bluos/sync.reading.js';
import { FOLLOWER_SYNC, REAL_SYNC_STATUS, SPEC_SYNC_STATUS, UNINITIALISED_SYNC } from '../fixtures/bluos.xml.js';

describe('readSyncStatus', () => {
    it('reads the specification’s own example, whose fields are all attributes', () => {
        expect(readSyncStatus(SPEC_SYNC_STATUS)).toMatchObject({
            etag: '23',
            name: 'PULSE-0278',
            brand: 'Bluesound',
            model: 'P300',
            modelName: 'PULSE',
            mac: '90:56:82:9F:02:78',
            id: '192.168.1.100:11000',
            initialized: true,
            volume: 4,
            fixedVolume: false,
            group: 'PULSE-0278 + 2',
        });
    });

    it('reads a group’s members, with the port each reported', () => {
        const sync = readSyncStatus(SPEC_SYNC_STATUS);
        expect(sync?.leader).toBe('192.168.1.100:11000');
        expect(sync?.followers).toEqual(['192.168.1.153:11000', '192.168.1.234:11000']);
    });

    // A follower's /Status is a copy of its leader's, so this is the only place its own level is.
    it('reads a follower’s own volume and who it follows', () => {
        const sync = readSyncStatus(FOLLOWER_SYNC);
        expect(sync).toMatchObject({ name: 'Kitchen', volume: 18, leader: '192.168.1.58:11000' });
        expect(sync?.followers).toEqual([]);
    });

    it('reads a player that has never been set up', () => {
        const sync = readSyncStatus(UNINITIALISED_SYNC);
        expect(sync?.initialized).toBe(false);
        expect(sync?.fixedVolume).toBe(true);
        expect(sync?.name).toBeUndefined();
    });

    it('assumes a player is set up when it does not say, rather than hiding it', () => {
        expect(readSyncStatus('<SyncStatus name="Study"/>')?.initialized).toBe(true);
    });

    describe('a real player', () => {
        const sync = readSyncStatus(REAL_SYNC_STATUS);

        it('reads who it is', () => {
            expect(sync).toMatchObject({ name: 'Office', brand: 'NAD', model: 'M10v2', modelName: 'M10 V2', volume: 19, initialized: true });
        });

        // An ungrouped player has no group attribute and no mute attribute at all.
        it('reads an ungrouped player as being in no group', () => {
            expect(sync?.group).toBeUndefined();
            expect(sync?.leader).toBeUndefined();
            expect(sync?.followers).toEqual([]);
            expect(sync?.muted).toBe(false);
        });

        // The etag here is what /Status reports as <syncStat>, which is how one long-poll covers both.
        it('carries the etag that /Status reports as syncStat', () => {
            expect(sync?.etag).toBe('203');
        });

        // Nested children the specification's example does not have, and attributes it never lists.
        it('is unbothered by fields the specification never documents', () => {
            expect(sync?.mac).toBe('90:56:82:00:BC:99');
            expect(sync?.id).toBe('192.168.1.234:11000');
        });
    });

    it('refuses a body that is not a SyncStatus response', () => {
        for (const junk of ['', 'nonsense', '<status><state>play</state></status>']) {
            expect(readSyncStatus(junk), junk).toBeUndefined();
        }
    });
});

describe('describePlayer', () => {
    it('uses the name its owner gave it', () => {
        expect(describePlayer(readSyncStatus(SPEC_SYNC_STATUS)!)).toBe('PULSE-0278');
    });

    it('falls back to the brand and model when it has never been named', () => {
        expect(describePlayer(readSyncStatus(UNINITIALISED_SYNC)!)).toBe('NAD C 658');
    });
});
