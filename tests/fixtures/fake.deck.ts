import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * The Stream Deck app, faked well enough to run the real bundle.
 *
 * The app launches a plugin as `node bin/plugin.js -port <p> -pluginUUID <uuid> -registerEvent
 * registerPlugin -info <json>` and talks to it over a WebSocket on that port. So a server on that
 * port, plus the four arguments, is the whole of what the plugin needs to believe it is installed —
 * which means every phase after this one can be checked against the ACTUAL bundle, decorators,
 * bundling and all, rather than against the source it was built from.
 *
 * It drives the built file on purpose. A test that imports `src/` would pass while the bundle was
 * broken, and the bundle is what ships.
 *
 * The plugin is spawned with its WORKING DIRECTORY set to a throwaway folder holding a COPY of
 * `manifest.json`, and that is not fussiness on two counts.
 *
 * It needs a directory with the manifest in it at all, because the SDK reads `manifest.json` off
 * the current directory the first time an action is registered. Launch it from anywhere else and it
 * throws "Failed to read manifest.json as the file does not exist" before it ever opens a socket,
 * and because the SDK leaves the web socket's `onerror` unhandled, the failure shows up only as a
 * silent exit 0 with no output at all. That cost an hour on the first day.
 *
 * And it needs its OWN directory rather than the real plugin folder, because the SDK rotates its
 * log files on startup by renaming each to the next number. Vitest runs files in parallel, so two
 * plugins starting at once both try to rename the same file, one loses with
 * `ENOENT: rename ...8.log -> ...9.log`, and that process DIES before connecting. It looked exactly
 * like a timeout and was chased as one twice. A private directory also keeps test runs out of the
 * log of whatever real plugin happens to be installed.
 */
const PLUGIN_DIR = resolve(import.meta.dirname, '../../com.maroonedsoftware.bluos.sdPlugin');
const BUNDLE = resolve(PLUGIN_DIR, 'bin/plugin.js');
const PLUGIN_UUID = 'com.maroonedsoftware.bluos';

/** A message the plugin sent the app. `event` is always there; the rest depends on the event. */
export interface FromPlugin {
    event: string;
    context?: string;
    device?: string;
    payload?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface FakeDeckOptions {
    /** The plugin's version, as the app would report it. */
    version?: string;
    /**
     * How long to wait for a message before giving up.
     *
     * Long, because this waits on a Node process starting while the rest of the suite is running
     * in parallel. Shorter than vitest's own timeout on purpose, so that the failure comes from
     * here with the list of what the plugin actually said rather than as a bare "test timed out".
     */
    timeoutMs?: number;
}

/** The device every `willAppear` in a test names. A Stream Deck +, so dials are in scope. */
export const DEVICE = {
    id: 'FAKE-DEVICE-0001',
    name: 'Fake Stream Deck +',
    size: { columns: 4, rows: 2 },
    type: 7,
} as const;

export class FakeDeck {
    private readonly server: WebSocketServer;
    private readonly options: Required<FakeDeckOptions>;
    private socket?: WebSocket;
    private child?: ChildProcess;
    private home?: string;
    /** Everything the plugin has said, in order, so a test can assert on what it missed. */
    readonly received: FromPlugin[] = [];
    /** Each key's own settings, as the app stores them against its context. */
    readonly settings = new Map<string, Record<string, unknown>>();
    /** The settings every key shares. */
    globalSettings: Record<string, unknown> = {};
    /** Everything the plugin's process wrote to stderr, noise included. */
    readonly stderr: string[] = [];
    private waiting: { match: (message: FromPlugin) => boolean; resolve: (message: FromPlugin) => void }[] = [];

    private constructor(server: WebSocketServer, options: Required<FakeDeckOptions>) {
        this.server = server;
        this.options = options;
    }

    /** Starts the app, launches the bundle, and resolves once the plugin has registered. */
    static async launch(options: FakeDeckOptions = {}): Promise<FakeDeck> {
        if (!existsSync(BUNDLE))
            throw new Error(`The bundle is not built. Run \`pnpm build\` (or \`pnpm test\`, which builds first). Looked in ${BUNDLE}`);

        const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
        await new Promise<void>(done => server.once('listening', done));
        const deck = new FakeDeck(server, { version: '0.1.0.0', timeoutMs: 15_000, ...options });

        deck.home = mkdtempSync(join(tmpdir(), 'bluos-deck-'));
        copyFileSync(join(PLUGIN_DIR, 'manifest.json'), join(deck.home, 'manifest.json'));

        server.on('connection', socket => {
            deck.socket = socket;
            socket.on('message', raw => deck.take(String(raw)));
        });

        const { port } = server.address() as { port: number };
        const info = {
            application: { font: 'Menlo', language: 'en', platform: 'mac', platformVersion: '14.0', version: '7.5.1' },
            colors: {
                buttonMouseOverBackgroundColor: '#464646',
                buttonPressedBackgroundColor: '#303030',
                buttonPressedBorderColor: '#646464',
                buttonPressedTextColor: '#969696',
                highlightColor: '#0080ff',
            },
            devicePixelRatio: 2,
            devices: [DEVICE],
            plugin: { uuid: PLUGIN_UUID, version: deck.options.version },
        };

        deck.child = spawn(
            process.execPath,
            [BUNDLE, '-port', String(port), '-pluginUUID', PLUGIN_UUID, '-registerEvent', 'registerPlugin', '-info', JSON.stringify(info)],
            {
                cwd: deck.home,
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
        deck.child.stderr?.on('data', chunk => deck.stderr.push(String(chunk)));

        await deck.next(message => message.event === 'registerPlugin');
        return deck;
    }

    /**
     * What the plugin itself wrote to stderr, which is where an unhandled failure lands.
     *
     * One line is filtered out, and only one: macOS writes "failed to copy trust settings of system
     * certificate" to the stderr of EVERY process it starts when the machine's trust store is in a
     * state it does not like. It has nothing to do with this plugin, it appears before Node runs a
     * line of it, and a test that asserted on raw stderr would fail on such a machine and pass in
     * CI, which is the wrong way round. Nothing else is hidden: an uncaught exception, a rejected
     * promise and anything the plugin prints itself all come through.
     */
    get faults(): string {
        return this.stderr
            .join('')
            .split('\n')
            .filter(line => line.trim() !== '' && !/failed to copy trust settings of system certificate/.test(line))
            .join('\n');
    }

    /** Sends the plugin an event, as the app would. */
    send(event: Record<string, unknown>): void {
        if (!this.socket) throw new Error('The plugin has not connected.');
        this.socket.send(JSON.stringify(event));
    }

    /** A key of `action` appears on the deck, carrying `settings`. */
    appear(context: string, action: string, settings: Record<string, unknown> = {}, controller: 'Keypad' | 'Encoder' = 'Keypad'): void {
        this.settings.set(context, settings);
        this.send({
            event: 'willAppear',
            action,
            context,
            device: DEVICE.id,
            payload: { controller, coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings },
        });
    }

    /** The user selects that key in the Stream Deck app, so its settings panel opens. */
    panelOpens(context: string, action: string): void {
        this.send({ event: 'propertyInspectorDidAppear', action, context, device: DEVICE.id });
    }

    /**
     * The panel writes a key's settings.
     *
     * In the Stream Deck app the property inspector has its OWN socket, so a `setSettings` from the
     * panel reaches the APP and the app then tells the plugin. Modelling it as a message on the
     * plugin's socket would be backwards, and would quietly test nothing.
     */
    panelWrites(context: string, settings: Record<string, unknown>): void {
        this.settings.set(context, settings);
        this.send({
            event: 'didReceiveSettings',
            context,
            device: DEVICE.id,
            payload: { settings, coordinates: { column: 0, row: 0 }, isInMultiAction: false },
        });
    }

    /** The panel writes the settings every key shares. */
    panelWritesGlobal(settings: Record<string, unknown>): void {
        this.globalSettings = settings;
        this.send({ event: 'didReceiveGlobalSettings', payload: { settings } });
    }

    /** The panel sends the plugin a message. */
    fromPanel(context: string, action: string, payload: unknown): void {
        this.send({ event: 'sendToPlugin', action, context, payload });
    }

    /** What the app would have stored for a key after everything the plugin asked it to. */
    settingsOf(context: string): Record<string, unknown> {
        return this.settings.get(context) ?? {};
    }

    /** How many messages the plugin has sent so far, as a watermark for `next(..., from)`. */
    get mark(): number {
        return this.received.length;
    }

    /**
     * The next message matching `match`.
     *
     * It searches what has ALREADY arrived first, because a plugin often answers before a test gets
     * round to asking. That is usually what you want and is occasionally a trap: waiting for a
     * frame a key drew once at startup will match that one and prove nothing. Pass `from`, taken
     * from `mark` before the thing you are testing, to wait for a genuinely new one.
     */
    next(match: (message: FromPlugin) => boolean, from = 0): Promise<FromPlugin> {
        const already = this.received.slice(from).find(match);
        if (already) return Promise.resolve(already);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiting = this.waiting.filter(w => w.resolve !== settle);
                reject(
                    new Error(
                        `Waited ${this.options.timeoutMs}ms for a message that never came. Got: ${this.received.map(m => m.event).join(', ') || 'nothing'}${this.faults ? `\nstderr: ${this.faults}` : ''}`,
                    ),
                );
            }, this.options.timeoutMs);
            const settle = (message: FromPlugin): void => {
                clearTimeout(timer);
                resolve(message);
            };
            this.waiting.push({ match, resolve: settle });
        });
    }

    /** Stops the plugin and the server. Safe to call twice, so a failing test still tidies up. */
    async close(): Promise<void> {
        this.child?.kill('SIGKILL');
        this.child = undefined;
        await new Promise<void>(done => this.server.close(() => done()));
        if (this.home !== undefined) rmSync(this.home, { recursive: true, force: true });
        this.home = undefined;
    }

    /**
     * Plays the app's part in the settings round trip.
     *
     * The plugin does not hold settings; it asks the app for them and the app answers, and a write
     * comes back as `didReceiveSettings` rather than being assumed. Without this the plugin's own
     * `getSettings()` would never resolve and every test that opens a panel would time out.
     */
    private answerSettings(message: FromPlugin): void {
        const context = typeof message.context === 'string' ? message.context : undefined;
        switch (message.event) {
            case 'setSettings':
                if (context) this.settings.set(context, (message.payload ?? {}) as Record<string, unknown>);
                if (context)
                    this.send({
                        event: 'didReceiveSettings',
                        context,
                        device: DEVICE.id,
                        payload: { settings: this.settingsOf(context), coordinates: { column: 0, row: 0 }, isInMultiAction: false },
                    });
                return;
            case 'getSettings':
                if (context)
                    this.send({
                        event: 'didReceiveSettings',
                        context,
                        device: DEVICE.id,
                        payload: { settings: this.settingsOf(context), coordinates: { column: 0, row: 0 }, isInMultiAction: false },
                    });
                return;
            case 'setGlobalSettings':
                this.globalSettings = (message.payload ?? {}) as Record<string, unknown>;
                this.send({ event: 'didReceiveGlobalSettings', payload: { settings: this.globalSettings } });
                return;
            case 'getGlobalSettings':
                this.send({ event: 'didReceiveGlobalSettings', payload: { settings: this.globalSettings } });
                return;
            default:
                return;
        }
    }

    private take(raw: string): void {
        let message: FromPlugin;
        try {
            message = JSON.parse(raw) as FromPlugin;
        } catch {
            return;
        }
        this.received.push(message);
        this.answerSettings(message);
        for (const waiter of [...this.waiting]) {
            if (!waiter.match(message)) continue;
            this.waiting = this.waiting.filter(w => w !== waiter);
            waiter.resolve(message);
        }
    }
}
