import { Bonjour } from 'bonjour-service';

import type { Browser, FoundService } from './discovery.js';

/**
 * The real mDNS browser.
 *
 * `bonjour-service` is pure JavaScript over Node's own `dgram` (through `multicast-dns` and
 * `dns-packet`), with no native build anywhere in it, which is what lets it travel inside a bundle
 * that ships no `node_modules`.
 *
 * Kept behind the `Browser` interface so every test drives a fake one: a test that opened a real
 * multicast socket would answer differently on every network it ran on, and would be rude on a
 * shared one.
 */
export function bonjourBrowser(): Browser {
    return {
        browse(types, onUp) {
            const bonjour = new Bonjour();
            const browsers = types.map(type => {
                const browser = bonjour.find({ type, protocol: 'tcp' });
                browser.on('up', service => {
                    onUp({
                        name: service.name,
                        port: service.port,
                        ...(service.host === undefined ? {} : { host: service.host }),
                        ...(service.addresses === undefined ? {} : { addresses: service.addresses }),
                    } satisfies FoundService);
                });
                browser.start();
                return browser;
            });

            return () => {
                for (const browser of browsers) browser.stop();
                // Destroying releases the multicast socket. Left open it keeps answering queries
                // from everything else on the network, which is rude and eventually confusing.
                bonjour.destroy();
            };
        },
    };
}
