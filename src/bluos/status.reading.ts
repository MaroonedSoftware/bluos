import { attribute, child, children, flag, number, parseXml, text, type XmlElement } from './xml.js';

/**
 * What a streaming radio station lets the player do, and where to ask for it.
 *
 * Section 4.8 of the specification: "Streaming radio stations do not load tracks into the play
 * queue. Instead, they provide a URL that you can use to accomplish the desired function." Each is
 * present only when the station offers it. An `<action name="back"/>` with no `url` is the player
 * saying back is NOT available here, and it is read as absent.
 */
export interface StreamActions {
    skip?: string;
    back?: string;
    love?: string;
    ban?: string;
}

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
    /** Changes whenever the player's presets change, matching `prid` on `/Presets`. */
    prid?: string;
    /** The input playing, when one is: the same id `/RadioBrowse?service=Capture` lists it under. */
    inputId?: string;
    /**
     * Minutes left on the sleep timer, when one is set. Absent means no timer.
     *
     * The specification documents this field but no command to set it. `/Sleep` does, measured on an
     * NAD M10 V2: it moves the timer on a step and answers `<sleep>15</sleep>`.
     */
    sleep?: number;
    /**
     * The skip, back, love and ban a streaming station offers, as URLs to ask.
     *
     * This is why a stream does not simply mean "no next track". The specification's own line is
     * "next and previous are not available (but see also actions)", and an earlier reading of it
     * dropped the part in brackets, so every stream refused Next even where the station would have
     * skipped. Radio Paradise, Slacker and Amazon's stations are the specification's examples.
     */
    actions: StreamActions;
    /** 0 is off, 1 is on. Irrelevant on a stream, where the specification says to leave it out of the UI. */
    shuffle?: boolean;
    /**
     * The player's own repeat state, which is NOT in the order anybody would guess: 0 repeats the
     * whole queue, 1 repeats one track, and 2 is off.
     */
    repeat?: 0 | 1 | 2;
}

/** The actions in a `<actions>` element, keeping only the ones that carry somewhere to ask. */
function streamActions(status: XmlElement): StreamActions {
    const found: StreamActions = {};
    for (const action of children(child(status, 'actions'), 'action')) {
        const name = attribute(action, 'name');
        const url = attribute(action, 'url');
        if (url === undefined) continue;
        if (name === 'skip' || name === 'back' || name === 'love' || name === 'ban') found[name] = url;
    }
    return found;
}

/** A number of minutes, or `undefined` for none: a timer at 0 is no timer. */
function positive(value: number | undefined): number | undefined {
    return value !== undefined && value > 0 ? value : undefined;
}

/** A repeat state, or `undefined` for anything the specification does not define. */
function repeatState(value: number | undefined): 0 | 1 | 2 | undefined {
    return value === 0 || value === 1 || value === 2 ? value : undefined;
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
        ...optional('prid', text(status, 'prid')),
        ...optional('inputId', text(status, 'inputId')),
        ...optional('sleep', positive(number(status, 'sleep'))),
        actions: streamActions(status),
        ...optional('shuffle', flag(text(status, 'shuffle'))),
        ...optional('repeat', repeatState(number(status, 'repeat'))),
    };
}

/** An object with the key, or an empty one, so an absent field stays absent under exactOptionalPropertyTypes. */
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
    return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
