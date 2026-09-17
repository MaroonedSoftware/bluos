import { attribute, children, flag, parseXml, toNumber, type XmlElement } from './xml.js';

/**
 * What `/SyncStatus` says: who this player is, and what group it is in.
 *
 * Read on demand rather than long-polled. The specification says one long-poll is enough because
 * `/Status` carries a `<syncStat>` element that changes whenever this response does, so this is
 * fetched on connect, on a change of player, on wake, and when `syncStat` moves.
 *
 * Everything here is an ATTRIBUTE of the root element, unlike `/Status` where everything is a child.
 */
export interface SyncReading {
    etag?: string;
    /** The name the owner gave the player in the Controller app. What a settings panel should show. */
    name?: string;
    brand?: string;
    model?: string;
    modelName?: string;
    /** The player's unique network id, which the specification says may be a MAC address. */
    mac?: string;
    /** The player's own "IP:port", as it reports it. */
    id?: string;
    /**
     * The player has been set up in the Controller app.
     *
     * A player answering `false` is on the network and reachable but cannot play anything, so
     * discovery lists it as needing setup rather than offering it.
     */
    initialized: boolean;
    /** 0..100, or absent when the output is fixed; see `fixedVolume`. */
    volume?: number;
    fixedVolume: boolean;
    muted: boolean;
    muteVolume?: number;
    /** The group's name, when this player is in one. */
    group?: string;
    /** This player follows another, whose address this is. Its /Status is a copy of the leader's. */
    leader?: string;
    /** The players following this one. */
    followers: readonly string[];
}

/** A `<master>`/`<slave>` element's address, which is its text or its id, with the port beside it. */
function address(element: XmlElement): string | undefined {
    const host = (element.text.trim() || attribute(element, 'id')) ?? undefined;
    if (host === undefined || host === '') return undefined;
    const port = attribute(element, 'port');
    return port === undefined || host.includes(':') ? host : `${host}:${port}`;
}

/** Reads a `/SyncStatus` response. Returns `undefined` when the body is not one. */
export function readSyncStatus(body: string): SyncReading | undefined {
    const sync = parseXml(body);
    if (sync?.name !== 'SyncStatus') return undefined;

    const reported = toNumber(attribute(sync, 'volume'));
    const fixedVolume = reported === -1;
    const leader = children(sync, 'master')
        .map(address)
        .find(found => found !== undefined);

    return {
        ...optional('etag', attribute(sync, 'etag')),
        ...optional('name', attribute(sync, 'name')),
        ...optional('brand', attribute(sync, 'brand')),
        ...optional('model', attribute(sync, 'model')),
        ...optional('modelName', attribute(sync, 'modelName')),
        ...optional('mac', attribute(sync, 'mac')),
        ...optional('id', attribute(sync, 'id')),
        initialized: flag(attribute(sync, 'initialized')) ?? true,
        ...optional('volume', fixedVolume ? undefined : reported),
        fixedVolume,
        muted: flag(attribute(sync, 'mute')) ?? false,
        ...optional('muteVolume', toNumber(attribute(sync, 'muteVolume'))),
        ...optional('group', attribute(sync, 'group')),
        ...optional('leader', leader),
        followers: children(sync, 'slave')
            .map(address)
            .filter((found): found is string => found !== undefined),
    };
}

/**
 * How a player should be named in a settings panel.
 *
 * The owner's own name for it first, because that is what they call it; the model only when they
 * have not named it, which happens on a player that has never been set up.
 */
export function describePlayer(sync: SyncReading): string {
    return sync.name ?? [sync.brand, sync.modelName ?? sync.model].filter(Boolean).join(' ') ?? 'BluOS player';
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
    return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
