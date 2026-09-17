/**
 * Asks a real BluOS player the questions this plugin's design rests on, and saves its answers.
 *
 * Everything in `tests/fixtures/bluos.xml.ts` beyond the two specification examples was written
 * from field descriptions rather than captured, and several design decisions rest on behaviour the
 * specification describes but does not pin down. This asks the player instead.
 *
 *   node tools/capture.mjs 192.168.1.100
 *   node tools/capture.mjs 192.168.1.100 --write   # also saves the responses under tests/fixtures/captured/
 *
 * It is READ-ONLY. Nothing here plays, pauses, or moves the volume, so it is safe to run against a
 * player somebody is listening to. The one question it cannot answer without writing is whether
 * `/Volume?level=N` comes back as exactly N; run that one by hand when the room is empty.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const [address, ...flags] = process.argv.slice(2);
if (!address) {
    console.error('Usage: node tools/capture.mjs <player address> [--write]');
    process.exit(2);
}
const write = flags.includes('--write');
const origin = address.includes('://') ? address.replace(/\/+$/, '') : `http://${address}${/:\d+$/.test(address) ? '' : ':11000'}`;
const OUT = 'tests/fixtures/captured';

/** One request, timed, with the body and how long it took. */
async function get(path, timeoutMs = 130_000) {
    const started = Date.now();
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    return { status: response.status, type: response.headers.get('content-type'), body, tookMs: Date.now() - started };
}

function save(name, body) {
    if (!write) return;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${name}`, body);
    console.log(`      saved ${OUT}/${name}`);
}

/** The etag attribute of a response's root element. */
function etagOf(body) {
    return /<\w+[^>]*\setag="([^"]*)"/.exec(body)?.[1];
}

console.log(`Asking ${origin}\n`);

// 1. Is anything there, and what is it?
const sync = await get('/SyncStatus', 10_000);
console.log(`/SyncStatus  ${sync.status}  ${sync.tookMs}ms  ${sync.type ?? 'no content-type'}`);
console.log(
    `      ${/name="([^"]*)"/.exec(sync.body)?.[1] ?? '(unnamed)'} — ${/brand="([^"]*)"/.exec(sync.body)?.[1] ?? '?'} ${/modelName="([^"]*)"/.exec(sync.body)?.[1] ?? ''}`,
);
save('SyncStatus.xml', sync.body);

const status = await get('/Status', 10_000);
console.log(`/Status      ${status.status}  ${status.tookMs}ms`);
save('Status.xml', status.body);
const etag = etagOf(status.body);
console.log(
    `      etag: ${etag === undefined ? 'NONE — long polling cannot work' : `"${etag}" (${etag.length} chars, ${/^[A-Za-z0-9]+$/.test(etag) ? 'no encoding needed' : 'NEEDS URL ENCODING'})`}`,
);

const field = name => new RegExp(`<${name}>([^<]*)</${name}>`).exec(status.body)?.[1];
console.log(`      state=${field('state')} volume=${field('volume')} secs=${field('secs')} totlen=${field('totlen') ?? '(none)'}`);
console.log(`      twoline_title1: ${field('twoline_title1') ?? 'ABSENT — the title1 fallback is the normal path here'}`);
console.log(`      streamUrl: ${field('streamUrl') ? 'present, so next/previous are unavailable' : 'absent, so the queue is the source'}`);

// 2. THE question the watcher's shape rests on: is a requested timeout honoured, or clamped to 100?
console.log('\nLong-poll timeout. Asking for 60 seconds with the current etag, which should hold until something changes.');
console.log('(Leave the player alone for a minute. Ctrl-C is fine if you would rather not wait.)');
const held = await get(`/Status?timeout=60&etag=${encodeURIComponent(etag ?? '')}`);
const seconds = Math.round(held.tookMs / 1000);
console.log(`      held ${seconds}s  ${held.status}`);
console.log(
    seconds >= 55 && seconds <= 70
        ? '      HONOURED. The design asks for 60 and gets 60.'
        : seconds >= 95
          ? '      CLAMPED TO ~100. The watcher must expect 100s holds, so the read deadline has to grow to match.'
          : seconds < 5
            ? '      RETURNED AT ONCE, so the state changed (or the etag was rejected). Run it again with the player idle.'
            : `      Neither 60 nor 100. The player held for ${seconds}s, which is what it does with a requested timeout.`,
);
if (etagOf(held.body) !== etag) console.log(`      the etag moved to "${etagOf(held.body)}", so something changed during the wait`);
save('Status.longpoll.xml', held.body);

// 3. Artwork, which decides whether the cover cache needs to sniff the content type.
const image = field('image');
if (image) {
    const path = image.startsWith('http') ? undefined : image;
    console.log(`\nArtwork: ${image}`);
    if (path) {
        const art = await get(`${path}${path.includes('?') ? '&' : '?'}followRedirects=1`, 15_000);
        console.log(
            `      ${art.status}  ${art.type ?? 'NO CONTENT-TYPE — the cover cache will have to sniff the magic number'}  ${art.body.length} bytes`,
        );
    } else {
        console.log('      absolute, so it is the service’s CDN rather than the player');
    }
}

console.log('\nStill to measure by hand, because they write to the player:');
console.log('  - /Volume?level=N: does the player report back exactly N, or clamp it to its configured dB range?');
console.log('  - does /Status bump its etag promptly when the volume moves?');
