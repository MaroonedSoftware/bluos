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
    close: () => Promise<void>;
}

export async function servePlayer(bodies: { status?: string; syncStatus?: string } = {}): Promise<ServedPlayer> {
    const requests: string[] = [];
    const server: Server = createServer((request, response) => {
        const path = request.url ?? '/';
        requests.push(path);
        const body = path.startsWith('/SyncStatus') ? (bodies.syncStatus ?? REAL_SYNC_STATUS) : (bodies.status ?? REAL_STREAM_STATUS);
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end(body);
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as { port: number };
    return {
        address: `127.0.0.1:${port}`,
        requests,
        close: () =>
            new Promise<void>(done => {
                server.closeAllConnections();
                server.close(() => done());
            }),
    };
}
