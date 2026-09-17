import { BluOsClient, type ClientOptions } from './client.js';
import { StatusWatcher, type WatcherOptions } from './status.watcher.js';

/**
 * One watcher per player, shared by every key pointed at that player.
 *
 * The sibling plugin has a single poller and is right to: one API key meant one station, and its
 * settings were global for that reason. Here the credential is gone, so the address is a per-key
 * setting, and four dials on a Stream Deck + are naturally four rooms. A single watcher would make
 * that impossible.
 *
 * Six keys on one player still cost one long-poll. Two players cost two idle sockets, which on a
 * local network is nothing. A dial and a key on the same player fall out with no special case.
 */
export class WatcherPool {
    private readonly watchers = new Map<string, StatusWatcher>();

    constructor(
        private readonly clientOptions: ClientOptions,
        private readonly watcherOptions: WatcherOptions = {},
    ) {}

    /** The watcher for this player, built on first use. */
    for(origin: string): StatusWatcher {
        const existing = this.watchers.get(origin);
        if (existing) return existing;
        const watcher = new StatusWatcher(new BluOsClient(origin, this.clientOptions), this.watcherOptions);
        this.watchers.set(origin, watcher);
        return watcher;
    }

    /** The players being watched. For the tests, and for a log line worth one sentence. */
    get origins(): string[] {
        return [...this.watchers.keys()];
    }

    /**
     * Start every watcher again from nothing, as after the machine wakes.
     *
     * Every socket slept through the suspend, so every one of them is dead and none of them will
     * say so until its deadline.
     */
    refreshAll(): void {
        for (const watcher of this.watchers.values()) watcher.refresh();
    }

    /**
     * Forgets a player nothing is watching any more.
     *
     * Called when a key changes which player it names, so that pointing the last key away from the
     * kitchen does not leave the kitchen's watcher in the map for the rest of the session. A
     * watcher still in its linger is left alone, because a key is about to come back to it.
     */
    tidy(): void {
        for (const [origin, watcher] of [...this.watchers]) {
            if (watcher.watching) continue;
            watcher.dispose();
            this.watchers.delete(origin);
        }
    }

    /** Stops everything. */
    disposeAll(): void {
        for (const watcher of this.watchers.values()) watcher.dispose();
        this.watchers.clear();
    }
}
