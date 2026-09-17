import { attribute, flag, number, parseXml, text, type XmlElement } from './xml.js';

/**
 * What `/Status` says, narrowed to the parts a key draws or acts on.
 *
 * Every field is optional and nothing throws on absence, because the specification says so twice:
 * "not all response attributes are listed... Other elements may be present and should be ignored"
 * and "Undocumented responses should be ignored". A firmware that renames a field should cost one
 * key its subtitle, not the whole plugin its start.
 */
export interface StatusReading {
    /** The opaque value the next long-poll sends back. Absent means ask again without one. */
    etag?: string;
    /** The player's own word: play, pause, stop, stream, connecting, and others. */
    state?: string;
    /**
     * Whether audio is coming out. The specification: "play and stream should be considered to have
     * the same meaning", and `stream` is what internet radio reports.
     */
    playing: boolean;
    /** The first line a two-line UI must show. */
    firstLine?: string;
    /** The second line a two-line UI must show. */
    secondLine?: string;
    /** Where the cover lives, as the player wrote it: usually relative, sometimes absolute. */
    image?: string;
    /** A radio station's own image, which the specification says may differ from `image`. */
    stationImage?: string;
    /** 0..100. Absent when the player did not say; see `fixedVolume` for -1. */
    volume?: number;
    /** The player has a fixed output level and the volume cannot be set. Reported as -1. */
    fixedVolume: boolean;
    muted: boolean;
    /** The level to come back to when unmuting. */
    muteVolume?: number;
    /** Seconds played. NOT part of the etag: a client has to advance this itself. */
    secs?: number;
    /** The track's length. Absent on a live stream, which is why a playhead may not guess. */
    totlen?: number;
    canSeek: boolean;
    /**
     * The play queue is the source, so next and previous exist.
     *
     * False when `/Status` carries a `streamUrl`, which the specification says means the queue is
     * not the source, that shuffle and repeat are irrelevant, and that "next and previous are not
     * available". Internet radio is the ordinary case.
     */
    queued: boolean;
    /** The service id. The specification warns this is not for display. */
    service?: string;
    /** Changes whenever /SyncStatus changes, which is how one long-poll covers both. */
    syncStat?: string;
    /** The group's name when this player leads one. */
    groupName?: string;
}

/** A state in which audio is playing. `stream` is what internet radio reports, and counts. */
function isPlaying(state: string | undefined): boolean {
    return state === 'play' || state === 'stream';
}

/**
 * The two lines a Stream Deck key shows.
 *
 * The specification is explicit and this is the rule most clients get wrong: "twoline_title1 &
 * twoline_title2, if present, MUST be used as the text of any UI that displays two lines", falling
 * back to title1 and title2, and "Do not use values such as album, artist and name". `pyblu`, which
 * is the obvious thing to copy, prefers `name` and `artist` and treats `title1` as the fallback. The
 * difference shows: on a radio stream `title1` is the station and `name` is whatever the stream
 * announced.
 */
function lines(status: XmlElement): { firstLine?: string; secondLine?: string } {
    const first = text(status, 'twoline_title1') ?? text(status, 'title1');
    const second = text(status, 'twoline_title2') ?? text(status, 'title2');
    return { ...(first === undefined ? {} : { firstLine: first }), ...(second === undefined ? {} : { secondLine: second }) };
}

/** Reads a `/Status` response. Returns `undefined` when the body is not one. */
export function readStatus(body: string): StatusReading | undefined {
    const status = parseXml(body);
    if (status?.name !== 'status') return undefined;

    const state = text(status, 'state');
    const reported = number(status, 'volume');
    // -1 is the player saying it has a fixed output level, not a volume of minus one.
    const fixedVolume = reported === -1;

    return {
        ...optional('etag', attribute(status, 'etag')),
        ...optional('state', state),
        playing: isPlaying(state),
        ...lines(status),
        ...optional('image', text(status, 'image')),
        ...optional('stationImage', text(status, 'stationImage')),
        ...optional('volume', fixedVolume ? undefined : reported),
        fixedVolume,
        muted: flag(text(status, 'mute')) ?? false,
        ...optional('muteVolume', number(status, 'muteVolume')),
        ...optional('secs', number(status, 'secs')),
        ...optional('totlen', number(status, 'totlen')),
        canSeek: flag(text(status, 'canSeek')) ?? false,
        queued: text(status, 'streamUrl') === undefined,
        ...optional('service', text(status, 'service')),
        ...optional('syncStat', text(status, 'syncStat')),
        ...optional('groupName', text(status, 'groupName')),
    };
}

/** An object with the key, or an empty one, so an absent field stays absent under exactOptionalPropertyTypes. */
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
    return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
