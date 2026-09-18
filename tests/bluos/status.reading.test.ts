import { describe, expect, it } from 'vitest';

import { readStatus } from '../../src/bluos/status.reading.js';
import {
    AWKWARD_TEXT,
    FIXED_VOLUME,
    MUTED,
    PLAYING_TWOLINE,
    RADIO,
    REAL_STREAM_STATUS,
    SLACKER_STATUS,
    SPEC_STATUS,
    STOPPED,
} from '../fixtures/bluos.xml.js';

describe('readStatus', () => {
    it('reads the specification’s own example', () => {
        const status = readStatus(SPEC_STATUS);
        expect(status).toMatchObject({
            etag: '4e266c9fbfba6d13d1a4d6ff4bd2e1e6',
            state: 'pause',
            playing: false,
            firstLine: 'Perfect',
            secondLine: 'Ed Sheeran',
            image: '/Artwork?service=Deezer&songid=Deezer%3A142986206',
            volume: 4,
            fixedVolume: false,
            muted: false,
            secs: 35,
            totlen: 263,
            canSeek: true,
            queued: true,
            service: 'Deezer',
            syncStat: '5',
        });
    });

    // The rule most clients get wrong. The specification: twoline_title1 and twoline_title2 MUST be
    // used by a two-line UI, and "Do not use values such as album, artist and name".
    it('prefers the two-line titles over title1 and title2', () => {
        const status = readStatus(PLAYING_TWOLINE);
        expect(status?.firstLine).toBe('Svefn-g-englar');
        expect(status?.secondLine).toBe('Sigur Rós • Ágætis byrjun');
    });

    it('falls back to title1 and title2 when there are no two-line titles', () => {
        const status = readStatus(SPEC_STATUS);
        expect(status?.firstLine).toBe('Perfect');
        expect(status?.secondLine).toBe('Ed Sheeran');
    });

    // Never `name`, `artist` or `album`, even though they are right there in the response.
    it('never reads the track’s name, artist or album', () => {
        const status = readStatus(SPEC_STATUS);
        expect(JSON.stringify(status)).not.toContain('÷ (Deluxe)');
    });

    describe('internet radio', () => {
        const status = readStatus(RADIO);

        it('counts stream as playing, because the specification says it means the same as play', () => {
            expect(status?.state).toBe('stream');
            expect(status?.playing).toBe(true);
        });

        it('says the queue is not the source, so next and previous do not exist', () => {
            expect(status?.queued).toBe(false);
        });

        it('has no total length for a playhead to draw', () => {
            expect(status?.totlen).toBeUndefined();
            expect(status?.secs).toBe(1844);
        });

        it('keeps the station’s own image apart from the cover', () => {
            expect(status?.image).toBe('https://img.radioparadise.com/channels/0/42/cover_512x512/0.jpg');
            expect(status?.stationImage).toBe('/Sources/images/ParadiseRadioIcon.png');
        });
    });

    it('reads a muted player and the level it would come back to', () => {
        expect(readStatus(MUTED)).toMatchObject({ muted: true, volume: 0, muteVolume: 41 });
    });

    // -1 is the player saying it has a fixed output, not a volume of minus one.
    it('reads -1 as a fixed output rather than as a level', () => {
        const status = readStatus(FIXED_VOLUME);
        expect(status?.fixedVolume).toBe(true);
        expect(status?.volume).toBeUndefined();
    });

    it('reads a stopped player, which /Play cannot resume', () => {
        expect(readStatus(STOPPED)).toMatchObject({ state: 'stop', playing: false });
    });

    it('carries entities and CDATA through into the lines a key draws', () => {
        const status = readStatus(AWKWARD_TEXT);
        expect(status?.firstLine).toBe('Simon & Garfunkel');
        expect(status?.secondLine).toBe('Parsley, Sage </title1> Rosemary & Thyme');
    });

    // Byte for byte off an NAD M10 V2 on BluOS 4.16.22. Everything above is either the
    // specification's own example or written from its field descriptions; this is a real player.
    describe('a real player, streaming', () => {
        const status = readStatus(REAL_STREAM_STATUS);

        it('reads the two-line titles the player actually sent', () => {
            expect(status?.firstLine).toBe('Deadair');
            expect(status?.secondLine).toBe('Led Zeppelin - When the Levee Breaks - Remaster');
        });

        it('knows a stream is playing, has no length, and cannot be skipped', () => {
            expect(status).toMatchObject({ state: 'stream', playing: true, queued: false, canSeek: false, secs: 9696 });
            expect(status?.totlen).toBeUndefined();
        });

        it('reads the level and the artwork the player is serving', () => {
            expect(status?.volume).toBe(19);
            expect(status?.muted).toBe(false);
            expect(status?.image).toBe('https://radio.deanhome.app/api/art/ef20a0c0-3957-486c-92d3-7a4f56fe8dad/cover.jpg');
        });

        // The specification prints `<sleep/>`; this player sends `<sleep></sleep>`. Both mean the
        // same nothing, and a reading that told them apart would be inventing a distinction.
        it('treats the player’s empty elements as absent', () => {
            expect(readStatus(REAL_STREAM_STATUS.replace('<sleep></sleep>', '<sleep/>'))).toEqual(status);
        });

        // The linkage that lets one long-poll cover both resources.
        it('carries the syncStat that matches the player’s SyncStatus etag', () => {
            expect(status?.syncStat).toBe('203');
        });
    });

    // Section 4.8: a stream is not the queue, but a station can still offer skip, back, love and ban.
    describe('a streaming station’s actions', () => {
        it('reads the ones the station offers, with the URL to ask', () => {
            expect(readStatus(SLACKER_STATUS)?.actions).toEqual({
                skip: '/Action?service=Slacker&skip=4799148',
                love: '/Action?service=Slacker&love=4799148',
                ban: '/Action?service=Slacker&ban=4799148',
            });
        });

        // `<action name="back"/>` with no url is the player saying back is NOT available here.
        it('reads an action with nowhere to ask as not offered', () => {
            expect(readStatus(SLACKER_STATUS)?.actions.back).toBeUndefined();
        });

        it('is empty for a stream that offers nothing, and for a queue', () => {
            expect(readStatus(REAL_STREAM_STATUS)?.actions).toEqual({});
            expect(readStatus(SPEC_STATUS)?.actions).toEqual({});
        });
    });

    // The player's own numbering, which is not the obvious one: 0 repeats the queue, 1 a track, 2 is off.
    it('reads shuffle and the repeat state as the player numbers it', () => {
        expect(readStatus(SPEC_STATUS)).toMatchObject({ shuffle: false, repeat: 2 });
    });

    it('refuses a body that is not a Status response', () => {
        for (const junk of ['', 'nonsense', '<html><body>404</body></html>', '<SyncStatus name="x"/>']) {
            expect(readStatus(junk), junk).toBeUndefined();
        }
    });

    // Every field is optional by the specification's own instruction to ignore what is not listed.
    it('reads a response carrying almost nothing', () => {
        expect(readStatus('<status><state>play</state></status>')).toMatchObject({
            playing: true,
            muted: false,
            canSeek: false,
            fixedVolume: false,
            queued: true,
        });
    });
});
