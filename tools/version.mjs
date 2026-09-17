/**
 * Mirrors package.json's version into the manifest's four-part `Version`.
 *
 * Elgato wants four parts and npm wants three, so `0.2.0` becomes `0.2.0.0`. The fourth part is a
 * build number that nothing here uses and that is left alone if somebody has set it by hand.
 *
 * The package's version is the one to edit. Changesets moves it, this moves the manifest to match,
 * and `--check` fails CI when the two have drifted, which is what stops a release shipping a
 * manifest that names the previous version.
 *
 *   node tools/version.mjs            # write the manifest
 *   node tools/version.mjs --check    # fail if it would have changed anything
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MANIFEST = 'com.maroonedsoftware.bluos.sdPlugin/manifest.json';
const check = process.argv.includes('--check');

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const raw = readFileSync(MANIFEST, 'utf8');
const manifest = JSON.parse(raw);

const build = manifest.Version?.split('.')[3] ?? '0';
const wanted = `${version}.${build}`;

if (manifest.Version === wanted) {
    console.log(`The manifest already says ${wanted}.`);
    process.exit(0);
}

if (check) {
    console.error(
        `::error::package.json is ${version} and the manifest says ${manifest.Version}. Run \`pnpm release:version\`, or edit the package's version rather than the manifest's.`,
    );
    process.exit(1);
}

// Rewritten as a string rather than re-serialised, so the manifest's own formatting survives.
writeFileSync(MANIFEST, raw.replace(/"Version":\s*"[^"]*"/, `"Version": "${wanted}"`));
console.log(`The manifest now says ${wanted}.`);
