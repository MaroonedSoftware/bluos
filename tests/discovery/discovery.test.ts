import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    BROWSE_MS,
    Discovery,
    SERVICE_TYPES,
    SETTLE_MS,
    ipv4Of,
    type BrowseOutcome,
    type Browser,
    type DiscoveredPlayer,
    type FoundService,
} from '../../src/discovery/discovery.js';
import { REAL_SYNC_STATUS } from '../fixtures/bluos.xml.js';

const settle = async (): Promise<void> => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 16; i++) await Promise.resolve();
};

/** An mDNS browser a test drives by hand. */
function fakeBrowser() {
    let announce: ((service: FoundService) => void) | undefined;
    let stopped = 0;
    let asked: readonly string[] = [];
    const browser: Browser = {
        browse(types, onUp) {
            asked = types;
            announce = onUp;
            return () => {
                stopped += 1;
                announce = undefined;
            };
        },
    };
    return {
        browser,
        get types() {
            return asked;
        },
        get stops() {
            return stopped;
        },
        find: (service: Partial<FoundService> & { addresses?: string[] } = {}) =>
            announce?.({ name: 'Office', port: 11000, host: 'office.local', addresses: ['192.168.1.234'], ...service }),
    };
}

/** Players that answer /SyncStatus, keyed by the host asked. */
function players(answers: Record<string, string | number>) {
    const asked: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        asked.push(url.host);
        const answer = answers[url.host];
        if (answer === undefined) return new Response('nope', { status: 404 });
        if (typeof answer === 'number') return new Response('nope', { status: answer });
        return new Response(answer, { headers: { 'content-type': 'application/xml' } });
    }) as typeof globalThis.fetch;
    return { fetch, asked };
}

interface Report {
    players: DiscoveredPlayer[];
    browsing: boolean;
    outcome: BrowseOutcome;
}

describe('ipv4Of', () => {
    it('takes the IPv4 address, not the .local name and not IPv6', () => {
        expect(ipv4Of({ name: 'x', port: 1, addresses: ['fe80::1', '192.168.1.5'] })).toBe('192.168.1.5');
        expect(ipv4Of({ name: 'x', port: 1, addresses: ['fe80::1'] })).toBeUndefined();
        expect(ipv4Of({ name: 'x', port: 1 })).toBeUndefined();
    });
});

describe('Discovery', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const rig = (answers: Record<string, string | number> = { '192.168.1.234:11000': REAL_SYNC_STATUS }) => {
        const net = fakeBrowser();
        const api = players(answers);
        const discovery = new Discovery({ browser: net.browser, client: { userAgent: 'test', fetch: api.fetch } });
        const reports: Report[] = [];
        return {
            net,
            api,
            discovery,
            reports,
            run: () => discovery.browse((p, browsing, outcome) => reports.push({ players: p, browsing, outcome })),
        };
    };

    // The two the specification names, and no more: each extra is another multicast socket and
    // another set of duplicates to reconcile.
    it('browses only the service types the specification names', () => {
        const { net, run } = rig();
        run();
        expect(net.types).toEqual(SERVICE_TYPES);
        expect([...SERVICE_TYPES]).toEqual(['musc', 'musp']);
    });

    // An mDNS answer says something is there. Only the player's own response says what it is.
    it('confirms a find by asking the player who it is', async () => {
        const { net, api, run, reports } = rig();
        run();
        net.find();
        await settle();
        expect(api.asked).toEqual(['192.168.1.234:11000']);

        await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
        expect(reports.at(-1)?.players[0]).toMatchObject({
            address: '192.168.1.234:11000',
            name: 'Office',
            model: 'NAD M10 V2',
            hostname: 'office.local',
        });
    });

    it('does not offer something that answered mDNS but not the API', async () => {
        const { net, run, reports } = rig({});
        run();
        net.find();
        await settle();
        await vi.advanceTimersByTimeAsync(BROWSE_MS + 100);
        await settle();
        expect(reports.at(-1)?.players).toEqual([]);
    });

    // The specification: port 11000 is not universal, because the CI580 has four nodes in one chassis.
    it('takes the port from the answer rather than assuming 11000', async () => {
        const { net, api, run } = rig({ '192.168.1.234:11010': REAL_SYNC_STATUS });
        run();
        net.find({ port: 11010 });
        await settle();
        expect(api.asked).toEqual(['192.168.1.234:11010']);
    });

    it('marks a player that has never been set up rather than hiding it', async () => {
        const { net, run, reports } = rig({ '192.168.1.99:11000': '<SyncStatus name="Spare" brand="NAD" model="C658" initialized="false"/>' });
        run();
        net.find({ addresses: ['192.168.1.99'] });
        await settle();
        await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
        expect(reports.at(-1)?.players[0]).toMatchObject({ name: 'Spare', needsSetup: true });
    });

    // So a burst of five players is one message rather than five renders of a growing list.
    it('gathers a burst of finds into one report', async () => {
        const answers: Record<string, string> = {};
        for (const n of [10, 11, 12]) answers[`192.168.1.${n}:11000`] = REAL_SYNC_STATUS;
        const { net, run, reports } = rig(answers);
        run();
        const before = reports.length;
        for (const n of [10, 11, 12]) net.find({ addresses: [`192.168.1.${n}`] });
        await settle();
        await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
        expect(reports.length - before).toBe(1);
        expect(reports.at(-1)?.players).toHaveLength(3);
    });

    // A browser left running holds a multicast socket and keeps answering the whole network.
    it('stops browsing after its window, and says it has stopped', async () => {
        const { net, run, reports } = rig();
        run();
        await vi.advanceTimersByTimeAsync(BROWSE_MS + 100);
        await settle();
        expect(net.stops).toBeGreaterThan(0);
        expect(reports.at(-1)?.browsing).toBe(false);
    });

    it('can be stopped early, for a panel that closed', () => {
        const { net, discovery, run } = rig();
        run();
        discovery.stop();
        expect(net.stops).toBe(1);
    });

    describe('when nothing is found', () => {
        // IoT VLANs, client isolation and several mesh routers block multicast. This is a normal
        // path, not an exception, and it is worded differently from a socket that would not open.
        it('says it searched and heard nothing', async () => {
            const { run, reports } = rig();
            run();
            await vi.advanceTimersByTimeAsync(BROWSE_MS + 100);
            await settle();
            expect(reports.at(-1)).toMatchObject({ players: [], browsing: false, outcome: 'silent' });
        });

        it('says so differently when the socket would not open at all', async () => {
            const reports: Report[] = [];
            const discovery = new Discovery({
                browser: {
                    browse() {
                        throw new Error('EADDRINUSE');
                    },
                },
                client: { userAgent: 'test' },
            });
            discovery.browse((p, browsing, outcome) => reports.push({ players: p, browsing, outcome }));
            expect(reports.at(-1)).toMatchObject({ browsing: false, outcome: 'unavailable' });
        });
    });

    // So reopening the panel fills the list at once instead of showing an empty box for five seconds.
    it('remembers what it found, and offers it before the next browse has answered', async () => {
        const { net, discovery, run, reports } = rig();
        run();
        net.find();
        await settle();
        await vi.advanceTimersByTimeAsync(BROWSE_MS + 100);
        await settle();
        expect(discovery.players).toHaveLength(1);

        reports.length = 0;
        run();
        expect(reports[0]).toMatchObject({ players: [{ name: 'Office' }], browsing: true });
    });

    it('does not list the same player twice when both service types answer', async () => {
        const { net, run, reports } = rig();
        run();
        net.find();
        net.find();
        await settle();
        await vi.advanceTimersByTimeAsync(SETTLE_MS + 10);
        expect(reports.at(-1)?.players).toHaveLength(1);
    });
});
