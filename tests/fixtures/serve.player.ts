import { createServer, type Server } from 'node:http';

import { REAL_STREAM_STATUS, REAL_SYNC_STATUS } from './bluos.xml.js';

/**
 * A BluOS player on a real socket, for the tests that drive the built bundle.
 *
 * The bundle runs in its own process, so it cannot be handed a fake `fetch` the way the unit tests
 * hand one to a client. It has to make a real request, which means something has to answer one.
 * Loopback is the only network a sandboxed test run has, and it is enough.
 *
 * It serves what an actual NAD M10 sent, so the end-to-end test proves the same bytes the unit
 * tests parse also survive the bundle, the socket and the panel.
 */
export interface ServedPlayer {
    /** The address to put in a key's settings, as somebody would type it. */
    address: string;
    /** Every path asked for, in order. */
    requests: string[];
    /** The next message matching, including ones already asked for. */
    asked: (path: string, timeoutMs?: number) => Promise<string>;
    close: () => Promise<void>;
}

export async function servePlayer(bodies: { status?: string; syncStatus?: string; presets?: string } = {}): Promise<ServedPlayer> {
    const requests: string[] = [];
    const waiting: { match: (path: string) => boolean; resolve: (path: string) => void }[] = [];
    const server: Server = createServer((request, response) => {
        const path = request.url ?? '/';
        requests.push(path);
        for (const one of [...waiting]) {
            if (!one.match(path)) continue;
            waiting.splice(waiting.indexOf(one), 1);
            one.resolve(path);
        }
        if (path.startsWith('/Presets')) {
            response.writeHead(200, { 'content-type': 'application/xml' });
            response.end(bodies.presets ?? '<presets prid="1"/>');
            return;
        }
        // A transport command answers with the state it produced, which is how a key flips without
        // a second request. Anything that is not a status read is treated as one.
        if (!path.startsWith('/Status') && !path.startsWith('/SyncStatus')) {
            response.writeHead(200, { 'content-type': 'application/xml' });
            response.end('<state>pause</state>');
            return;
        }
        const body = path.startsWith('/SyncStatus') ? (bodies.syncStatus ?? REAL_SYNC_STATUS) : (bodies.status ?? REAL_STREAM_STATUS);
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end(body);
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as { port: number };
    return {
        address: `127.0.0.1:${port}`,
        requests,
        asked: (path, timeoutMs = 4_000) => {
            const match = (asked: string): boolean => asked.startsWith(path);
            if (requests.some(match)) return Promise.resolve(requests.find(match) as string);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error(`The player was never asked for ${path}. It was asked for: ${requests.join(', ') || 'nothing'}`)),
                    timeoutMs,
                );
                waiting.push({
                    match,
                    resolve: asked => {
                        clearTimeout(timer);
                        resolve(asked);
                    },
                });
            });
        },
        close: () =>
            new Promise<void>(done => {
                server.closeAllConnections();
                server.close(() => done());
            }),
    };
}
