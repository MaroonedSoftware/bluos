/**
 * Runs a TypeScript preview script.
 *
 * The plugin's sources use NodeNext, so they import each other as `./thing.js` while the file on
 * disk is `./thing.ts`. Node cannot follow that and esbuild's command line does not rewrite it, so
 * this bundles with a twenty-line resolver that does, and runs the result.
 *
 *   node tools/preview/run.mjs tools/preview/now.playing.preview.ts
 */
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) {
    console.error('Usage: node tools/preview/run.mjs <script.ts>');
    process.exit(2);
}

const out = resolve(process.env.TMPDIR ?? '/tmp', `preview-${Date.now()}.mjs`);
await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outfile: out,
    plugins: [
        {
            name: 'nodenext-js-to-ts',
            setup(builder) {
                builder.onResolve({ filter: /^\.{1,2}\/.*\.js$/ }, args => {
                    const asTs = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'));
                    return existsSync(asTs) ? { path: asTs } : undefined;
                });
            },
        },
    ],
});

await import(pathToFileURL(out).href);
void dirname;
