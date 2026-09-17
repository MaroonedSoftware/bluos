import { BluOsClient, type ClientOptions } from '../bluos/client.js';
import { describePlayer } from '../bluos/sync.reading.js';

/**
 * The service types the specification names, and only those.
 *
 * "[BluOS players] are discovered by use of the MDNS protocol using the services musc.tcp and
 * musp.tcp." The `musz` and `mush` types that some third-party clients browse are not in the
 * specification; browsing them would be two more multicast sockets and two more sets of duplicates
 * to reconcile for nothing. Appendix 13.1's LSDP is the documented alternative if these ever fail.
 */
export const SERVICE_TYPES = ['musc', 'musp'] as const;

/** How long to browse before giving up and saying so. */
export const BROWSE_MS = 5_000;

/** How long to gather finds before telling the panel, so a burst of five is one message. */
export const SETTLE_MS = 150;

/**
 * A player somebody could choose.
 *
 * A type alias rather than an interface, and not as a matter of taste: this is sent to the settings
 * panel through the SDK, whose `sendToPropertyInspector` takes a JSON value, and an interface does
 * not satisfy an index signature. The settings types are aliases for the same reason.
 */
export type DiscoveredPlayer = {
    /** What to put in the address field: the IPv4 address and port. */
    address: string;
    /** The name its owner gave it in the BluOS app. */
    name: string;
    /** The brand and model, for telling two identical names apart. */
    model?: string;
    /** Its `.local` name, kept as the fallback for when DHCP has moved it. */
    hostname?: string;
    /** The player answered but has never been set up, so it cannot play anything yet. */
    needsSetup?: boolean;
};

/** Why a browse found nothing, which is not the same question as whether it found nothing. */
export type BrowseOutcome =
    /** The browse ran. Whatever it found is all there was. */
    | 'ok'
    /** It ran and nothing answered, which on a network that filters multicast is the normal result. */
    | 'silent'
    /** The socket could not even be opened: a denied firewall prompt, or 5353 already taken. */
    | 'unavailable';

/** What a single mDNS answer looks like, narrowed to what is used. */
export interface FoundService {
    name: string;
    port: number;
    host?: string;
    addresses?: string[];
}

/** The mDNS browser, as an interface so a test can be one. */
export interface Browser {
    /** Calls `onUp` for every answer, and the returned function stops it. */
    browse(types: readonly string[], onUp: (service: FoundService) => void): () => void;
}

export interface DiscoveryOptions {
    browser: Browser;
    client: ClientOptions;
    browseMs?: number;
    settleMs?: number;
    setTimer?: typeof setTimeout;
}

/** The first IPv4 address in an answer, which is what to connect to. */
export function ipv4Of(service: FoundService): string | undefined {
    return service.addresses?.find(address => /^\d{1,3}(\.\d{1,3}){3}$/.test(address));
}

/**
 * Finds BluOS players on the network.
 *
 * It runs in the PLUGIN process, and it has to: the settings panel is a Chromium page with no
 * `dgram`, no raw sockets and no multicast. That is worth writing down because it is exactly the
 * thing somebody will later try to simplify by moving it into the panel.
 *
 * Every find is confirmed with `/SyncStatus` before it is offered. An mDNS answer says something is
 * there; only the player's own response says what it is, gives it the name its owner chose, and
 * reveals that it has never been set up.
 *
 * The browser is never left running. It holds a multicast socket and goes on answering, which is
 * rude on a shared network, so it browses for five seconds and stops.
 */
export class Discovery {
    private readonly options: Required<Omit<DiscoveryOptions, 'browser' | 'client'>>;
    /** Remembered for the session so reopening the panel fills the list at once. */
    private readonly found = new Map<string, DiscoveredPlayer>();
    private stopBrowsing?: () => void;
    private outcome: BrowseOutcome = 'ok';

    constructor(private readonly deps: DiscoveryOptions) {
        this.options = { browseMs: BROWSE_MS, settleMs: SETTLE_MS, setTimer: setTimeout, ...deps };
    }

    /** What has been found so far this session, newest names last. */
    get players(): DiscoveredPlayer[] {
        return [...this.found.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Browses, telling `report` as players arrive and once more when it stops.
     *
     * `browsing` says whether more may still come, so a panel can show a spinner and then a result
     * rather than an empty list that might or might not be final.
     */
    browse(report: (players: DiscoveredPlayer[], browsing: boolean, outcome: BrowseOutcome) => void): void {
        this.stop();
        this.outcome = 'ok';
        // Whatever was found earlier goes out at once, so a reopened panel is never empty while it waits.
        report(this.players, true, this.outcome);

        let pending = false;
        const tell = (browsing: boolean): void => {
            pending = false;
            report(this.players, browsing, this.outcome);
        };
        const soon = (): void => {
            if (pending) return;
            pending = true;
            this.options.setTimer(() => tell(true), this.options.settleMs);
        };

        try {
            this.stopBrowsing = this.deps.browser.browse(SERVICE_TYPES, service => {
                void this.confirm(service).then(found => {
                    if (!found) return;
                    this.found.set(found.address, found);
                    soon();
                });
            });
        } catch {
            // The socket could not be opened at all, which is a different thing from finding nothing.
            this.outcome = 'unavailable';
            report(this.players, false, this.outcome);
            return;
        }

        this.options.setTimer(() => {
            this.stop();
            if (this.outcome === 'ok' && this.found.size === 0) this.outcome = 'silent';
            tell(false);
        }, this.options.browseMs);
    }

    /** Stops the browser. Safe to call when nothing is running. */
    stop(): void {
        this.stopBrowsing?.();
        this.stopBrowsing = undefined;
    }

    /**
     * Asks a find who it is.
     *
     * The port comes from the answer rather than being assumed, because the specification records
     * that port 11000 is not universal: the CI580 puts four streamer nodes in one chassis and only
     * the first is on 11000.
     */
    private async confirm(service: FoundService): Promise<DiscoveredPlayer | undefined> {
        const host = ipv4Of(service);
        if (host === undefined || !Number.isFinite(service.port)) return undefined;
        const address = `${host}:${service.port}`;

        try {
            const sync = await new BluOsClient(`http://${address}`, this.deps.client).syncStatus(AbortSignal.timeout(4_000));
            const model = [sync.brand, sync.modelName ?? sync.model].filter(Boolean).join(' ');
            return {
                address,
                name: describePlayer(sync),
                ...(model === '' ? {} : { model }),
                ...(service.host === undefined ? {} : { hostname: service.host }),
                ...(sync.initialized ? {} : { needsSetup: true }),
            };
        } catch {
            // Something answered mDNS and not the API. It is not a player anybody can use.
            return undefined;
        }
    }
}
